import { randomUUID } from "node:crypto";

import { assertBambuFileSize, getBambuFile, sanitizeBambuFileName, setBambuFile } from "./store";

export const runtime = "nodejs";
export const dynamic = "force-static";

function getRequestFileName(request: Request) {
  return sanitizeBambuFileName(request.headers.get("x-file-name") ?? "model.3mf");
}

function getContentDisposition(name: string) {
  const safeName = sanitizeBambuFileName(name).replace(/"/g, "");

  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

export async function POST(request: Request) {
  try {
    const arrayBuffer = await request.arrayBuffer();

    assertBambuFileSize(arrayBuffer.byteLength);

    const id = randomUUID();
    const name = getRequestFileName(request);

    setBambuFile(id, {
      contentType: "model/3mf",
      data: arrayBuffer,
      name,
    });

    return Response.json({
      name,
      url: new URL(
        `/api/bambu/three-mf?id=${encodeURIComponent(id)}&download=1`,
        request.url,
      ).toString(),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Could not prepare 3MF for Bambu Studio.",
      },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Missing 3MF file id." }, { status: 400 });
  }

  const file = getBambuFile(id);

  if (!file) {
    return Response.json({ error: "3MF file expired." }, { status: 404 });
  }

  return new Response(file.data, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": getContentDisposition(file.name),
      "Content-Length": String(file.data.byteLength),
      "Content-Type": file.contentType,
    },
  });
}
