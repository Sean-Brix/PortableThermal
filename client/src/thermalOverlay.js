const MAX_RENDER_SIZE = 1600;
const ANALYSIS_GRID_SIZE = 240;
const HOT_SEED_QUANTILE = 0.965;
const HOT_REGION_QUANTILE = 0.94;
const HOT_SEED_RANGE_RATIO = 0.12;
const HOT_REGION_RANGE_RATIO = 0.08;
const MAX_HOTSPOTS = 6;
const MIN_HOT_COMPONENT_RATIO = 0.0007;

export function createRawJpegFromVideo(video) {
  const canvas = makeCanvas(video.videoWidth, video.videoHeight);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  return {
    src: canvas.toDataURL("image/jpeg", 0.92),
    width: canvas.width,
    height: canvas.height
  };
}

export async function createRawJpegFromFile(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }

  const image = await loadImage(file);
  const { width, height } = fitDimensions(image.naturalWidth, image.naturalHeight);
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return {
    src: canvas.toDataURL("image/jpeg", 0.92),
    width: canvas.width,
    height: canvas.height
  };
}

export async function createAnnotatedJpegFromSource(src, scale, regions = null) {
  const image = await loadImageFromSource(src);
  const canvas = makeCanvas(image.naturalWidth, image.naturalHeight);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  annotateThermalCanvas(canvas, context, scale, regions);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function annotateThermalCanvas(canvas, context, scale, regions) {
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const analysis = analyzeThermalImage(imageData, canvas.width, canvas.height, regions);
  const hotBoxes = analysis.hotSpots.map((spot) => spot.box);

  for (const box of hotBoxes) {
    drawBox(context, box, "#ff2d2d", formatTemperature(scale.temperature), canvas);
  }

  drawAmbientLabel(context, hotBoxes, "#2d8cff", formatTemperature(scale.ambiance), canvas);
}

function analyzeThermalImage(imageData, width, height, regions) {
  const grid = buildAnalysisGrid(imageData.data, width, height);

  return {
    hotSpots: selectHotSpots(grid, regions?.hot)
  };
}

function selectHotSpots(grid, region) {
  const roi = region
    ? normalizeRegion(region, grid.width, grid.height)
    : fullImageRegion(grid.width, grid.height);
  const samples = grid.samples.filter((sample) => sampleInRegion(sample, roi));
  if (!samples.length) {
    throw new Error("Thermal image area is too small.");
  }

  const scores = samples.map((sample) => sample.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const scoreRange = Math.max(1, maxScore - minScore);
  const seedCutoff = Math.max(
    quantile(scores, HOT_SEED_QUANTILE),
    maxScore - scoreRange * HOT_SEED_RANGE_RATIO
  );
  const regionCutoff = Math.max(
    quantile(scores, HOT_REGION_QUANTILE),
    seedCutoff - scoreRange * HOT_REGION_RANGE_RATIO
  );
  const minimumCount = Math.max(4, Math.round(samples.length * MIN_HOT_COMPONENT_RATIO));

  const seedComponents = connectedComponents(
    grid,
    (sample) => sampleInRegion(sample, roi) && sample.score >= seedCutoff,
    1
  );
  const seeds = seedComponents
    .sort((a, b) => componentRank(b, samples.length) - componentRank(a, samples.length))
    .slice(0, MAX_HOTSPOTS * 2);

  const regionComponents = connectedComponents(
    grid,
    (sample) => sampleInRegion(sample, roi) && sample.score >= regionCutoff,
    1
  );

  const candidates = seeds.length
    ? regionComponents.filter((component) => seeds.some((seed) => componentsOverlap(component, seed)))
    : regionComponents;
  const components = uniqueComponents(candidates.length ? candidates : regionComponents)
    .filter((component) => component.count >= minimumCount)
    .sort((a, b) => componentRank(b, samples.length) - componentRank(a, samples.length))
    .slice(0, MAX_HOTSPOTS);

  if (!components.length) {
    components.push(fallbackComponent(samples));
  }

  return components.map((component) => ({
    box: componentToBox(component, grid, grid.width, grid.height, 0.012, roi)
  }));
}

function buildAnalysisGrid(data, width, height) {
  const step = Math.max(1, Math.ceil(Math.max(width, height) / ANALYSIS_GRID_SIZE));
  const gridWidth = Math.ceil(width / step);
  const gridHeight = Math.ceil(height / step);
  const samples = [];
  const sampleByCell = new Array(gridWidth * gridHeight);

  for (let gy = 0; gy < gridHeight; gy += 1) {
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const x = clamp(Math.round(gx * step + step / 2), 0, width - 1);
      const y = clamp(Math.round(gy * step + step / 2), 0, height - 1);
      const offset = (y * width + x) * 4;
      const sample = {
        gx,
        gy,
        x,
        y,
        r: data[offset],
        g: data[offset + 1],
        b: data[offset + 2],
        score: thermalBrightness(data[offset], data[offset + 1], data[offset + 2])
      };
      samples.push(sample);
      sampleByCell[gy * gridWidth + gx] = sample;
    }
  }

  return { width, height, gridWidth, gridHeight, sampleByCell, samples, step };
}

function connectedComponents(grid, predicate, minimumCount) {
  const visited = new Uint8Array(grid.sampleByCell.length);
  const components = [];

  for (let index = 0; index < grid.sampleByCell.length; index += 1) {
    if (visited[index]) continue;

    const first = grid.sampleByCell[index];
    if (!first || !predicate(first)) {
      visited[index] = 1;
      continue;
    }

    const queue = [index];
    visited[index] = 1;
    const component = makeComponent();

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const currentIndex = queue[cursor];
      const sample = grid.sampleByCell[currentIndex];
      addSampleToComponent(component, sample, currentIndex);

      const neighbors = neighborIndexes(sample.gx, sample.gy, grid.gridWidth, grid.gridHeight);
      for (const neighborIndex of neighbors) {
        if (visited[neighborIndex]) continue;

        const neighbor = grid.sampleByCell[neighborIndex];
        visited[neighborIndex] = 1;
        if (neighbor && predicate(neighbor)) {
          queue.push(neighborIndex);
        }
      }
    }

    finalizeComponent(component);
    components.push(component);
  }

  return components.filter((component) => component.count >= minimumCount);
}

function makeComponent() {
  return {
    count: 0,
    indexes: [],
    minGX: Infinity,
    minGY: Infinity,
    maxGX: -Infinity,
    maxGY: -Infinity,
    sumGX: 0,
    sumGY: 0,
    scoreSum: 0
  };
}

function addSampleToComponent(component, sample, index = null) {
  component.count += 1;
  if (index !== null) component.indexes.push(index);
  component.minGX = Math.min(component.minGX, sample.gx);
  component.minGY = Math.min(component.minGY, sample.gy);
  component.maxGX = Math.max(component.maxGX, sample.gx);
  component.maxGY = Math.max(component.maxGY, sample.gy);
  component.sumGX += sample.gx;
  component.sumGY += sample.gy;
  component.scoreSum += sample.score;
}

function finalizeComponent(component) {
  component.centerGX = component.sumGX / component.count;
  component.centerGY = component.sumGY / component.count;
  component.avgScore = component.scoreSum / component.count;
}

function componentRank(component, sampleCount) {
  const areaBonus = Math.sqrt(component.count / sampleCount) * 45;
  return component.avgScore + areaBonus;
}

function componentsOverlap(component, seed) {
  const indexes = new Set(component.indexes);
  return seed.indexes.some((index) => indexes.has(index));
}

function uniqueComponents(components) {
  return [...new Set(components)];
}

function fallbackComponent(samples) {
  const sample = samples.reduce((best, current) => {
    if (!best) return current;
    return current.score > best.score ? current : best;
  }, null);

  const component = makeComponent();
  addSampleToComponent(component, sample);
  finalizeComponent(component);
  return component;
}

function componentToBox(component, grid, width, height, paddingRatio, roi) {
  const cellWidth = width / grid.gridWidth;
  const cellHeight = height / grid.gridHeight;
  const padding = Math.max(2, Math.min(width, height) * paddingRatio);
  const left = Math.max(roi.x, component.minGX * cellWidth - padding);
  const top = Math.max(roi.y, component.minGY * cellHeight - padding);
  const right = Math.min(roi.x + roi.width, (component.maxGX + 1) * cellWidth + padding);
  const bottom = Math.min(roi.y + roi.height, (component.maxGY + 1) * cellHeight + padding);

  return clampBox(left, top, right - left, bottom - top, width, height);
}

function drawBox(context, box, color, label, canvas) {
  const lineWidth = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) / 760));
  const borderWidth = lineWidth + Math.max(3, Math.round(lineWidth * 1.6));

  context.save();
  context.lineJoin = "round";
  context.strokeStyle = "#ffffff";
  context.lineWidth = borderWidth;
  context.strokeRect(box.x, box.y, box.width, box.height);
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.strokeRect(box.x, box.y, box.width, box.height);
  drawLabel(context, label, box, color, canvas);
  context.restore();
}

function drawAmbientLabel(context, hotBoxes, color, label, canvas) {
  if (!hotBoxes.length) return;

  const dimensions = measureLabel(context, label, canvas);
  const anchor = unionBoxes(hotBoxes);
  const gap = Math.max(5, Math.round(dimensions.fontSize * 0.35));
  const candidates = [
    { left: anchor.x, top: anchor.y + anchor.height + gap },
    { left: anchor.x, top: anchor.y - dimensions.height - gap },
    { left: anchor.x + anchor.width + gap, top: anchor.y },
    { left: anchor.x - dimensions.width - gap, top: anchor.y },
    { left: 4, top: canvas.height - dimensions.height - 4 },
    { left: 4, top: 4 }
  ];
  const position = candidates
    .map((candidate) => clampLabelPosition(candidate, dimensions, canvas))
    .find((candidate) => !hotBoxes.some((box) => boxesOverlap(labelRect(candidate, dimensions), box))) ||
    clampLabelPosition(candidates[0], dimensions, canvas);

  context.save();
  drawLabelAt(context, label, position.left, position.top, color, dimensions);
  context.restore();
}

function drawLabel(context, label, box, color, canvas) {
  const dimensions = measureLabel(context, label, canvas);
  const left = clamp(box.x + 4, 2, canvas.width - dimensions.width - 2);
  const top = clamp(box.y + 4, 2, canvas.height - dimensions.height - 2);

  drawLabelAt(context, label, left, top, color, dimensions);
}

function measureLabel(context, label, canvas) {
  const fontSize = Math.max(14, Math.round(Math.min(canvas.width, canvas.height) / 42));
  const paddingX = Math.round(fontSize * 0.45);
  const paddingY = Math.round(fontSize * 0.28);
  const font = `700 ${fontSize}px Inter, Arial, sans-serif`;

  context.font = font;
  const metrics = context.measureText(label);

  return {
    font,
    fontSize,
    height: fontSize + paddingY * 2,
    paddingX,
    paddingY,
    width: metrics.width + paddingX * 2
  };
}

function drawLabelAt(context, label, left, top, color, dimensions) {
  const textX = left + dimensions.paddingX;
  const textY = top + dimensions.fontSize + dimensions.paddingY * 0.2;

  context.font = dimensions.font;
  context.fillStyle = "rgba(5, 6, 7, 0.78)";
  context.fillRect(left, top, dimensions.width, dimensions.height);
  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.lineWidth = Math.max(1, Math.round(dimensions.fontSize / 12));
  context.strokeRect(left, top, dimensions.width, dimensions.height);
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(2, Math.round(dimensions.fontSize / 8));
  context.strokeText(label, textX, textY);
  context.fillStyle = color;
  context.fillText(label, textX, textY);
}

function unionBoxes(boxes) {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function clampLabelPosition(position, dimensions, canvas) {
  const maxLeft = Math.max(2, canvas.width - dimensions.width - 2);
  const maxTop = Math.max(2, canvas.height - dimensions.height - 2);

  return {
    left: clamp(position.left, 2, maxLeft),
    top: clamp(position.top, 2, maxTop)
  };
}

function labelRect(position, dimensions) {
  return {
    x: position.left,
    y: position.top,
    width: dimensions.width,
    height: dimensions.height
  };
}

function boxesOverlap(a, b) {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function normalizeRegion(region, width, height) {
  const x = clamp(Math.round(region.x), 0, width - 1);
  const y = clamp(Math.round(region.y), 0, height - 1);
  const right = clamp(Math.round(region.x + region.width), x + 1, width);
  const bottom = clamp(Math.round(region.y + region.height), y + 1, height);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y
  };
}

function fullImageRegion(width, height) {
  return {
    x: 0,
    y: 0,
    width,
    height
  };
}

function sampleInRegion(sample, region) {
  return (
    sample.x >= region.x &&
    sample.y >= region.y &&
    sample.x <= region.x + region.width &&
    sample.y <= region.y + region.height
  );
}

function thermalBrightness(r, g, b) {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function neighborIndexes(gx, gy, width, height) {
  const neighbors = [];
  for (let y = gy - 1; y <= gy + 1; y += 1) {
    for (let x = gx - 1; x <= gx + 1; x += 1) {
      if (x === gx && y === gy) continue;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      neighbors.push(y * width + x);
    }
  }
  return neighbors;
}

function quantile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.floor((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index];
}

function clampBox(left, top, width, height, canvasWidth, canvasHeight) {
  const x = clamp(Math.round(left), 0, canvasWidth - 1);
  const y = clamp(Math.round(top), 0, canvasHeight - 1);
  const boxWidth = clamp(Math.round(width), 1, canvasWidth - x);
  const boxHeight = clamp(Math.round(height), 1, canvasHeight - y);

  return { x, y, width: boxWidth, height: boxHeight };
}

function fitDimensions(width, height) {
  const scale = Math.min(1, MAX_RENDER_SIZE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load that image."));
    };
    image.src = url;
  });
}

function loadImageFromSource(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load that image."));
    image.src = src;
  });
}

function formatTemperature(value) {
  return Number.isInteger(value) ? `${value}` : `${value.toFixed(1)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
