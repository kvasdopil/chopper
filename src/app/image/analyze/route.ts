import { NextResponse } from "next/server";

export const runtime = "nodejs";

const geminiModel = "gemini-3.1-flash-lite";
const maxInlineImageBytes = 20 * 1024 * 1024;

type GeminiPart = {
  text?: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

type AutoNamedObject = {
  name: string;
  x: number;
  y: number;
};

const objectSchema = {
  type: "OBJECT",
  properties: {
    objects: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: {
            type: "STRING",
            description: "Short camelCase name for the visible object part.",
          },
          x: {
            type: "NUMBER",
            description: "Horizontal pixel coordinate from the left edge of the image.",
          },
          y: {
            type: "NUMBER",
            description: "Vertical pixel coordinate from the top edge of the image.",
          },
        },
        required: ["name", "x", "y"],
      },
    },
  },
  required: ["objects"],
};

function getGeminiApiKey() {
  return (process.env.GEMINI_API_KEY || "").trim();
}

function getImageDimension(value: FormDataEntryValue | null, fallback: number) {
  const dimension = Number(value);

  return Number.isFinite(dimension) && dimension > 0 ? dimension : fallback;
}

function getPrompt(imageWidth: number, imageHeight: number) {
  return [
    `This is a ${imageWidth}x${imageHeight} pixel PNG from the current camera view of a 3D model I created and separated into parts.`,
    "The view is orthographic, not perspective.",
    `A semitransparent 4x4 grid is overlaid on the image; grid lines are at x=${imageWidth / 4}, ${imageWidth / 2}, ${(imageWidth * 3) / 4} and y=${imageHeight / 4}, ${imageHeight / 2}, ${(imageHeight * 3) / 4}.`,
    "The separated objects are indicated by color: each distinct visible color region is a separate object.",
    "For each distinct visible object color, provide one short camelCase object name and one coordinate near the visible center of that color region.",
    "For left/right paired parts, use an L or R suffix notation such as eyeL, eyeR, shoeL, or shoeR; do not use leftEye, rightEye, leftShoe, or rightShoe.",
    `Use pixel coordinates in the image: top-left is (0, 0), x increases to the right, y increases downward, and bottom-right is (${imageWidth}, ${imageHeight}).`,
  ].join(" ");
}

function normalizeObjects(value: unknown): AutoNamedObject[] {
  const objects = (value as { objects?: unknown }).objects;

  if (!Array.isArray(objects)) {
    return [];
  }

  return objects
    .map((object) => {
      const candidate = object as Partial<AutoNamedObject>;

      return {
        name: typeof candidate.name === "string" ? candidate.name : "",
        x: typeof candidate.x === "number" ? candidate.x : Number.NaN,
        y: typeof candidate.y === "number" ? candidate.y : Number.NaN,
      };
    })
    .filter(
      (object) =>
        object.name.trim().length > 0 && Number.isFinite(object.x) && Number.isFinite(object.y),
    );
}

function parseGeminiObjects(text: string) {
  try {
    return normalizeObjects(JSON.parse(text));
  } catch {
    return null;
  }
}

async function readImageAnalyzeFormData(request: Request) {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return NextResponse.json({ error: "Set GEMINI_API_KEY in .env." }, { status: 500 });
  }

  const formData = await readImageAnalyzeFormData(request);

  if (!formData) {
    return NextResponse.json({ error: "Upload a PNG image." }, { status: 400 });
  }

  const image = formData.get("image");
  const imageWidth = getImageDimension(formData.get("imageWidth"), 1024);
  const imageHeight = getImageDimension(formData.get("imageHeight"), 1024);

  if (!(image instanceof File) || image.type !== "image/png") {
    return NextResponse.json({ error: "Upload a PNG image." }, { status: 400 });
  }

  if (image.size > maxInlineImageBytes) {
    return NextResponse.json(
      { error: "Image is too large for inline Gemini input." },
      { status: 400 },
    );
  }

  const imageBase64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
    {
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  data: imageBase64,
                  mime_type: "image/png",
                },
              },
              { text: getPrompt(imageWidth, imageHeight) },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: "application/json",
          response_schema: objectSchema,
        },
      }),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      method: "POST",
      signal: request.signal,
    },
  );

  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();

    return NextResponse.json(
      { error: errorText || "Gemini image analysis failed." },
      { status: geminiResponse.status },
    );
  }

  const payload = (await geminiResponse.json()) as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;

  if (!text) {
    return NextResponse.json({ error: "Gemini returned no object names." }, { status: 502 });
  }

  const objects = parseGeminiObjects(text);

  if (!objects) {
    return NextResponse.json(
      { error: "Gemini returned invalid structured JSON." },
      { status: 502 },
    );
  }

  return NextResponse.json({ objects });
}
