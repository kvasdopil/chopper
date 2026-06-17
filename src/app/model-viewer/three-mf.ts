import * as THREE from "three";

const contentTypesPath = "[Content_Types].xml";
const relationshipsPath = "_rels/.rels";
const modelPath = "3D/3dmodel.model";
const triangleAreaEpsilon = 1e-18;
const orientationScoreEpsilon = 1e-12;

type ZipEntry = {
  data: Uint8Array;
  name: string;
};

type ThreeMfTriangle = [number, number, number];

type ThreeMfMesh = {
  name: string;
  triangles: ThreeMfTriangle[];
  vertices: THREE.Vector3[];
};

type TriangleEdgeRecord = {
  direction: 1 | -1;
  triangleIndex: number;
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

  const rounded = Number(value.toFixed(6));

  return Object.is(rounded, -0) ? "0" : rounded.toString();
}

function getTriangleAreaSquared(
  vertices: THREE.Vector3[],
  firstIndex: number,
  secondIndex: number,
  thirdIndex: number,
) {
  const first = vertices[firstIndex];
  const second = vertices[secondIndex];
  const third = vertices[thirdIndex];

  if (!first || !second || !third) {
    return 0;
  }

  return new THREE.Vector3()
    .subVectors(second, first)
    .cross(new THREE.Vector3().subVectors(third, first))
    .lengthSq();
}

function triangleHasArea(
  vertices: THREE.Vector3[],
  firstIndex: number,
  secondIndex: number,
  thirdIndex: number,
) {
  return (
    getTriangleAreaSquared(vertices, firstIndex, secondIndex, thirdIndex) > triangleAreaEpsilon
  );
}

function getTriangleEdges([firstIndex, secondIndex, thirdIndex]: ThreeMfTriangle): Array<
  [number, number]
> {
  return [
    [firstIndex, secondIndex],
    [secondIndex, thirdIndex],
    [thirdIndex, firstIndex],
  ];
}

function getTriangleEdgeKey(firstIndex: number, secondIndex: number) {
  return firstIndex < secondIndex ? `${firstIndex}:${secondIndex}` : `${secondIndex}:${firstIndex}`;
}

function getTriangleEdgeDirection(firstIndex: number, secondIndex: number): 1 | -1 {
  return firstIndex < secondIndex ? 1 : -1;
}

function getFlippedTriangle([
  firstIndex,
  secondIndex,
  thirdIndex,
]: ThreeMfTriangle): ThreeMfTriangle {
  return [firstIndex, thirdIndex, secondIndex];
}

function getOrientedTriangle(triangle: ThreeMfTriangle, flipped: boolean) {
  return flipped ? getFlippedTriangle(triangle) : triangle;
}

function getComponentOrientationScore(vertices: THREE.Vector3[], triangles: ThreeMfTriangle[]) {
  const bounds = new THREE.Box3();
  const componentVertexIndexes = new Set<number>();

  triangles.forEach((triangle) => {
    triangle.forEach((vertexIndex) => {
      if (componentVertexIndexes.has(vertexIndex)) {
        return;
      }

      const vertex = vertices[vertexIndex];

      if (!vertex) {
        return;
      }

      componentVertexIndexes.add(vertexIndex);
      bounds.expandByPoint(vertex);
    });
  });

  if (bounds.isEmpty()) {
    return 0;
  }

  const center = bounds.getCenter(new THREE.Vector3());
  let score = 0;

  triangles.forEach(([firstIndex, secondIndex, thirdIndex]) => {
    const first = vertices[firstIndex];
    const second = vertices[secondIndex];
    const third = vertices[thirdIndex];

    if (!first || !second || !third) {
      return;
    }

    const normal = new THREE.Vector3()
      .subVectors(second, first)
      .cross(new THREE.Vector3().subVectors(third, first));
    const triangleCenter = first
      .clone()
      .add(second)
      .add(third)
      .multiplyScalar(1 / 3);

    score += normal.dot(triangleCenter.sub(center));
  });

  return score;
}

function orientTriangleShells(vertices: THREE.Vector3[], triangles: ThreeMfTriangle[]) {
  const edgeRecordsByKey = new Map<string, TriangleEdgeRecord[]>();

  triangles.forEach((triangle, triangleIndex) => {
    getTriangleEdges(triangle).forEach(([firstIndex, secondIndex]) => {
      const edgeKey = getTriangleEdgeKey(firstIndex, secondIndex);
      const record = {
        direction: getTriangleEdgeDirection(firstIndex, secondIndex),
        triangleIndex,
      };
      const records = edgeRecordsByKey.get(edgeKey);

      if (records) {
        records.push(record);
      } else {
        edgeRecordsByKey.set(edgeKey, [record]);
      }
    });
  });

  const visited = new Array<boolean>(triangles.length).fill(false);
  const flipped = new Array<boolean>(triangles.length).fill(false);

  for (let startTriangleIndex = 0; startTriangleIndex < triangles.length; startTriangleIndex += 1) {
    if (visited[startTriangleIndex]) {
      continue;
    }

    const queue = [startTriangleIndex];
    const componentTriangleIndexes: number[] = [];

    visited[startTriangleIndex] = true;

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const triangleIndex = queue[queueIndex];
      const triangle = triangles[triangleIndex];

      componentTriangleIndexes.push(triangleIndex);

      getTriangleEdges(triangle).forEach(([firstIndex, secondIndex]) => {
        const edgeKey = getTriangleEdgeKey(firstIndex, secondIndex);
        const records = edgeRecordsByKey.get(edgeKey);

        if (!records) {
          return;
        }

        const currentDirection =
          getTriangleEdgeDirection(firstIndex, secondIndex) * (flipped[triangleIndex] ? -1 : 1);

        records.forEach((record) => {
          if (record.triangleIndex === triangleIndex || visited[record.triangleIndex]) {
            return;
          }

          flipped[record.triangleIndex] = -currentDirection / record.direction < 0;
          visited[record.triangleIndex] = true;
          queue.push(record.triangleIndex);
        });
      });
    }

    const componentTriangles = componentTriangleIndexes.map((triangleIndex) =>
      getOrientedTriangle(triangles[triangleIndex], flipped[triangleIndex]),
    );
    const orientationScore = getComponentOrientationScore(vertices, componentTriangles);

    if (orientationScore < -orientationScoreEpsilon) {
      componentTriangleIndexes.forEach((triangleIndex) => {
        flipped[triangleIndex] = !flipped[triangleIndex];
      });
    }
  }

  return triangles.map((triangle, triangleIndex) =>
    getOrientedTriangle(triangle, flipped[triangleIndex]),
  );
}

function compactMeshTriangles(
  name: string,
  sourceVertices: THREE.Vector3[],
  sourceTriangles: ThreeMfTriangle[],
) {
  const vertexIndexBySourceIndex = new Map<number, number>();
  const vertices: THREE.Vector3[] = [];
  const triangles: ThreeMfTriangle[] = [];
  const getVertexIndex = (sourceIndex: number) => {
    const existingIndex = vertexIndexBySourceIndex.get(sourceIndex);

    if (existingIndex !== undefined) {
      return existingIndex;
    }

    const vertexIndex = vertices.length;
    const vertex = sourceVertices[sourceIndex];

    vertexIndexBySourceIndex.set(sourceIndex, vertexIndex);
    vertices.push(vertex.clone());

    return vertexIndex;
  };

  sourceTriangles.forEach(([firstIndex, secondIndex, thirdIndex]) => {
    if (!triangleHasArea(sourceVertices, firstIndex, secondIndex, thirdIndex)) {
      return;
    }

    triangles.push([
      getVertexIndex(firstIndex),
      getVertexIndex(secondIndex),
      getVertexIndex(thirdIndex),
    ]);
  });

  return triangles.length > 0 ? { name, triangles, vertices } : null;
}

function createRepairedMesh(name: string, vertices: THREE.Vector3[], triangles: ThreeMfTriangle[]) {
  const orientedTriangles = orientTriangleShells(vertices, triangles);

  return compactMeshTriangles(name, vertices, orientedTriangles);
}

function getMeshTriangles(mesh: THREE.Mesh): ThreeMfMesh | null {
  const position = mesh.geometry.getAttribute("position");

  if (!(position instanceof THREE.BufferAttribute)) {
    return null;
  }

  const index = mesh.geometry.getIndex();
  const vertices: THREE.Vector3[] = [];
  const triangles: ThreeMfTriangle[] = [];

  mesh.updateMatrixWorld(true);

  const shouldFlipWinding = mesh.matrixWorld.determinant() < 0;

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
        triangles.push(
          shouldFlipWinding
            ? [firstIndex, thirdIndex, secondIndex]
            : [firstIndex, secondIndex, thirdIndex],
        );
      }
    }
  } else {
    for (let vertexIndex = 0; vertexIndex + 2 < position.count; vertexIndex += 3) {
      if (triangleHasArea(vertices, vertexIndex, vertexIndex + 1, vertexIndex + 2)) {
        triangles.push(
          shouldFlipWinding
            ? [vertexIndex, vertexIndex + 2, vertexIndex + 1]
            : [vertexIndex, vertexIndex + 1, vertexIndex + 2],
        );
      }
    }
  }

  return triangles.length > 0
    ? createRepairedMesh(mesh.name.trim() || "Object", vertices, triangles)
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

function moveMeshesToBuildPlate(meshes: ThreeMfMesh[]) {
  let minZ = Infinity;

  meshes.forEach((mesh) => {
    mesh.vertices.forEach((vertex) => {
      minZ = Math.min(minZ, vertex.z);
    });
  });

  if (!Number.isFinite(minZ) || Math.abs(minZ) <= 0.0000005) {
    return;
  }

  meshes.forEach((mesh) => {
    mesh.vertices.forEach((vertex) => {
      vertex.z -= minZ;
    });
  });
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

  moveMeshesToBuildPlate(meshes);

  return createStoredZip([
    { name: contentTypesPath, data: encodeText(createContentTypesXml()) },
    { name: relationshipsPath, data: encodeText(createRelationshipsXml()) },
    { name: modelPath, data: encodeText(createModelXml(meshes)) },
  ]);
}
