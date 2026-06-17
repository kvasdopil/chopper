import * as THREE from "three";

const contentTypesPath = "[Content_Types].xml";
const relationshipsPath = "_rels/.rels";
const modelPath = "3D/3dmodel.model";

type ZipEntry = {
  data: Uint8Array;
  name: string;
};

type ThreeMfMesh = {
  name: string;
  triangles: Array<[number, number, number]>;
  vertices: THREE.Vector3[];
};

const crc32Table = new Uint32Array(256);

for (let index = 0; index < crc32Table.length; index += 1) {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  crc32Table[index] = value >>> 0;
}

function getCrc32(data: Uint8Array) {
  let value = 0xffffffff;

  data.forEach((byte) => {
    value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
  });

  return (value ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return { dosDate, dosTime };
}

function writeUint16(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function encodeText(value: string) {
  return new TextEncoder().encode(value);
}

function toBytes(values: number[]) {
  return new Uint8Array(values);
}

function joinBytes(chunks: Uint8Array[]) {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.length;
  });

  return bytes.buffer;
}

function createStoredZip(entries: ZipEntry[]) {
  const outputChunks: Uint8Array[] = [];
  const centralDirectoryChunks: Uint8Array[] = [];
  const { dosDate, dosTime } = getDosDateTime();
  let outputByteLength = 0;

  entries.forEach((entry) => {
    const name = encodeText(entry.name);
    const crc = getCrc32(entry.data);
    const localHeaderOffset = outputByteLength;
    const localHeader: number[] = [];
    const centralDirectoryHeader: number[] = [];

    writeUint32(localHeader, 0x04034b50);
    writeUint16(localHeader, 20);
    writeUint16(localHeader, 0);
    writeUint16(localHeader, 0);
    writeUint16(localHeader, dosTime);
    writeUint16(localHeader, dosDate);
    writeUint32(localHeader, crc);
    writeUint32(localHeader, entry.data.length);
    writeUint32(localHeader, entry.data.length);
    writeUint16(localHeader, name.length);
    writeUint16(localHeader, 0);

    const localHeaderBytes = toBytes([...localHeader, ...name]);

    outputChunks.push(localHeaderBytes, entry.data);
    outputByteLength += localHeaderBytes.length + entry.data.length;

    writeUint32(centralDirectoryHeader, 0x02014b50);
    writeUint16(centralDirectoryHeader, 20);
    writeUint16(centralDirectoryHeader, 20);
    writeUint16(centralDirectoryHeader, 0);
    writeUint16(centralDirectoryHeader, 0);
    writeUint16(centralDirectoryHeader, dosTime);
    writeUint16(centralDirectoryHeader, dosDate);
    writeUint32(centralDirectoryHeader, crc);
    writeUint32(centralDirectoryHeader, entry.data.length);
    writeUint32(centralDirectoryHeader, entry.data.length);
    writeUint16(centralDirectoryHeader, name.length);
    writeUint16(centralDirectoryHeader, 0);
    writeUint16(centralDirectoryHeader, 0);
    writeUint16(centralDirectoryHeader, 0);
    writeUint16(centralDirectoryHeader, 0);
    writeUint32(centralDirectoryHeader, 0);
    writeUint32(centralDirectoryHeader, localHeaderOffset);
    centralDirectoryChunks.push(toBytes([...centralDirectoryHeader, ...name]));
  });

  const centralDirectoryOffset = outputByteLength;
  const centralDirectoryByteLength = centralDirectoryChunks.reduce(
    (total, chunk) => total + chunk.length,
    0,
  );
  const endRecord: number[] = [];

  writeUint32(endRecord, 0x06054b50);
  writeUint16(endRecord, 0);
  writeUint16(endRecord, 0);
  writeUint16(endRecord, entries.length);
  writeUint16(endRecord, entries.length);
  writeUint32(endRecord, centralDirectoryByteLength);
  writeUint32(endRecord, centralDirectoryOffset);
  writeUint16(endRecord, 0);

  return joinBytes([...outputChunks, ...centralDirectoryChunks, toBytes(endRecord)]);
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return Number(value.toFixed(6)).toString();
}

function triangleHasArea(
  vertices: THREE.Vector3[],
  firstIndex: number,
  secondIndex: number,
  thirdIndex: number,
) {
  const first = vertices[firstIndex];
  const second = vertices[secondIndex];
  const third = vertices[thirdIndex];

  if (!first || !second || !third) {
    return false;
  }

  return (
    new THREE.Vector3()
      .subVectors(second, first)
      .cross(new THREE.Vector3().subVectors(third, first))
      .lengthSq() > 0
  );
}

function getMeshTriangles(mesh: THREE.Mesh): ThreeMfMesh | null {
  const position = mesh.geometry.getAttribute("position");

  if (!(position instanceof THREE.BufferAttribute)) {
    return null;
  }

  const index = mesh.geometry.getIndex();
  const vertices: THREE.Vector3[] = [];
  const triangles: Array<[number, number, number]> = [];

  mesh.updateMatrixWorld(true);

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    vertices.push(
      new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld),
    );
  }

  if (index) {
    for (let itemIndex = 0; itemIndex + 2 < index.count; itemIndex += 3) {
      const firstIndex = index.getX(itemIndex);
      const secondIndex = index.getX(itemIndex + 1);
      const thirdIndex = index.getX(itemIndex + 2);

      if (triangleHasArea(vertices, firstIndex, secondIndex, thirdIndex)) {
        triangles.push([firstIndex, secondIndex, thirdIndex]);
      }
    }
  } else {
    for (let vertexIndex = 0; vertexIndex + 2 < position.count; vertexIndex += 3) {
      if (triangleHasArea(vertices, vertexIndex, vertexIndex + 1, vertexIndex + 2)) {
        triangles.push([vertexIndex, vertexIndex + 1, vertexIndex + 2]);
      }
    }
  }

  return triangles.length > 0
    ? {
        name: mesh.name.trim() || "Object",
        triangles,
        vertices,
      }
    : null;
}

function getSceneMeshes(scene: THREE.Scene) {
  const meshes: ThreeMfMesh[] = [];

  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh === true) {
      const mesh = getMeshTriangles(child as THREE.Mesh);

      if (mesh) {
        meshes.push(mesh);
      }
    }
  });

  return meshes;
}

function createContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
}

function createRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/${modelPath}" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
}

function createModelXml(meshes: ThreeMfMesh[]) {
  const resources = meshes
    .map((mesh, index) => {
      const objectId = index + 1;
      const vertices = mesh.vertices
        .map(
          (vertex) =>
            `        <vertex x="${formatNumber(vertex.x)}" y="${formatNumber(vertex.y)}" z="${formatNumber(vertex.z)}"/>`,
        )
        .join("\n");
      const triangles = mesh.triangles
        .map(
          ([firstIndex, secondIndex, thirdIndex]) =>
            `        <triangle v1="${firstIndex}" v2="${secondIndex}" v3="${thirdIndex}"/>`,
        )
        .join("\n");

      return `    <object id="${objectId}" type="model" name="${escapeXml(mesh.name)}">
      <mesh>
      <vertices>
${vertices}
      </vertices>
      <triangles>
${triangles}
      </triangles>
      </mesh>
    </object>`;
    })
    .join("\n");
  const buildItems = meshes.map((_, index) => `    <item objectid="${index + 1}"/>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">3D Model Playground</metadata>
  <resources>
${resources}
  </resources>
  <build>
${buildItems}
  </build>
</model>`;
}

export function createThreeMfPackage(scene: THREE.Scene) {
  const meshes = getSceneMeshes(scene);

  if (meshes.length === 0) {
    return null;
  }

  return createStoredZip([
    { name: contentTypesPath, data: encodeText(createContentTypesXml()) },
    { name: relationshipsPath, data: encodeText(createRelationshipsXml()) },
    { name: modelPath, data: encodeText(createModelXml(meshes)) },
  ]);
}
