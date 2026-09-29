// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, type JSX } from 'react';
import QR from 'qrcode-generator';

export type PropsType = Readonly<{
  size: number;
  link: string;
  color: string;
}>;

// SWARM change (B3, 2026-09-29): the mark in the middle of every QR code the
// app draws is the SWARM mark (images/swarm-mark.svg, the same three paths in
// its own 1000 x 467.95 viewBox), not Signal's speech bubble. It is drawn by
// a nested <svg> so the paths stay exactly as in the brand file; the test
// ts/test-node/swarm/swarmLinks_test.preload.tsx keeps the two in step.
export const SWARM_MARK_VIEWBOX_WIDTH = 1000;
export const SWARM_MARK_VIEWBOX_HEIGHT = 467.95;
export const SWARM_MARK_PATHS: ReadonlyArray<string> = [
  'M0 0 L500.01 320.38 L1000 0 L818.26 15.25 L500.01 224.53 L181.74 15.' +
    '25 Z',
  'M277.3 323.87 C274.12 323.5 270.97 323.42 267.82 322.72 C255.87 320.' +
    '09 245.32 312.13 235.74 304.87 C228.05 299.07 220.14 293.31 213.27 2' +
    '86.52 C206.75 280.08 201.21 272.73 195.62 265.48 C177.27 241.57 162.' +
    '99 215.03 153.07 186.54 C148.5 173.43 144.03 160.23 139.94 146.97 C1' +
    '36.92 137.18 133.89 122.87 128.41 114.45 C125.83 110.5 122.22 107.22' +
    ' 118.51 104.36 C108.38 96.56 96.95 90.45 86.14 83.64 C79.37 79.37 73' +
    '.12 74.4 66.43 70.04 C60.6 66.24 54.43 63.01 48.57 59.31 C38.72 53.0' +
    '9 29.59 44.98 19.11 39.88 C14.89 37.84 10.45 37.21 5.93 36.25 C5.56 ' +
    '39.62 4.64 43.17 4.55 46.74 C4.39 54.06 6.67 61.6 8.09 68.73 C9.26 7' +
    '4.49 10.29 80.29 11.19 86.09 C14.41 106.65 16.02 127.51 19.64 147.99' +
    ' C20.48 152.72 21.66 157.39 22.53 162.12 C25.7 179.35 27.98 196.8 32' +
    '.13 213.84 C33.87 221.04 36.34 228 38.7 235.03 C43.76 250.17 48.7 26' +
    '5.4 55.27 279.98 C58.99 288.22 63.48 296.01 67.77 303.94 C108.96 380' +
    '.09 168.73 420.22 250.04 445.8 C261.75 449.48 273.84 451.68 285.7 45' +
    '4.78 C292.27 456.51 298.75 458.53 305.39 460.03 C309.96 461.07 314.6' +
    '5 461.57 319.26 462.37 C328.75 464 338.15 466.15 347.6 467.95 C352.3' +
    '8 465.77 357.25 463.73 361.81 460.9 C370.98 455.23 379.03 447.92 387' +
    '.14 440.86 C394.05 434.83 401.4 429.18 407.88 422.66 C419.52 410.96 ' +
    '430.15 397.78 439.95 384.52 C443.46 379.79 447.24 375.1 450.19 369.9' +
    '8 C452.34 366.28 453.8 362.29 455.46 358.39 C454.07 356.82 453.12 35' +
    '4.85 451.54 353.22 C448.43 350 444.48 347.51 440.97 344.74 C435.24 3' +
    '40.17 429.79 335.27 424.19 330.54 C420.02 330.72 415.77 330.67 411.5' +
    '4 331.31 C406.73 332.04 402.09 333.56 397.34 334.63 C387.94 336.76 3' +
    '78.38 338.44 368.79 339.42 C348.21 341.57 301.06 338.92 283.07 329.2' +
    '8 C280.42 327.86 279.11 325.97 277.17 323.8 Z',
  'M722.83 323.8 C720.89 325.97 719.6 327.86 716.95 329.28 C698.95 338.' +
    '92 651.79 341.57 631.21 339.42 C621.63 338.44 612.06 336.76 602.66 3' +
    '34.63 C597.92 333.56 593.29 332.04 588.46 331.31 C584.23 330.67 579.' +
    '98 330.72 575.71 330.57 C570.22 335.27 564.76 340.17 559.03 344.74 C' +
    '555.54 347.51 551.58 350 548.46 353.22 C546.9 354.85 545.94 356.82 5' +
    '44.52 358.53 C546.22 362.29 547.67 366.28 549.82 369.98 C552.78 375.' +
    '1 556.56 379.79 560.06 384.52 C569.87 397.78 580.49 410.96 592.12 42' +
    '2.66 C598.62 429.18 605.97 434.83 612.88 440.86 C620.97 447.92 629.0' +
    '3 455.23 638.21 460.9 C642.76 463.73 647.64 465.77 652.5 467.95 C661' +
    '.87 466.15 671.25 464 680.75 462.37 C685.37 461.57 690.04 461.07 694' +
    '.63 460.03 C701.25 458.53 707.74 456.51 714.3 454.78 C726.16 451.68 ' +
    '738.27 449.48 749.96 445.8 C831.29 420.22 891.04 380.09 932.24 303.9' +
    '4 C936.52 296.01 941.01 288.22 944.73 279.98 C951.3 265.4 956.24 250' +
    '.17 961.32 235.03 C963.66 228 966.13 221.04 967.87 213.84 C972.02 19' +
    '6.8 974.32 179.35 977.48 162.12 C978.36 157.39 979.52 152.72 980.36 ' +
    '147.99 C983.98 127.51 985.59 106.65 988.82 86.09 C989.73 80.29 990.7' +
    '4 74.49 991.91 68.73 C993.35 61.6 995.62 54.06 995.45 46.74 C995.36 ' +
    '43.17 994.46 39.62 993.89 36.12 C989.57 37.21 985.11 37.84 980.91 39' +
    '.88 C970.41 44.98 961.28 53.09 951.45 59.31 C945.57 63.01 939.4 66.2' +
    '4 933.58 70.04 C926.88 74.4 920.63 79.37 913.86 83.64 C903.07 90.45 ' +
    '891.63 96.56 881.49 104.36 C877.78 107.22 874.17 110.5 871.61 114.45' +
    ' C866.13 122.87 863.08 137.18 860.07 146.97 C855.99 160.23 851.5 173' +
    '.43 846.94 186.54 C837.02 215.03 822.75 241.57 804.38 265.48 C798.81' +
    ' 272.73 793.27 280.08 786.73 286.52 C779.86 293.31 771.95 299.07 764' +
    '.27 304.87 C754.68 312.13 744.15 320.09 732.18 322.72 C729.03 323.42' +
    ' 725.9 323.5 722.71 323.87 Z',
];

const AUTODETECT_TYPE_NUMBER = 0;
const ERROR_CORRECTION_LEVEL = 'H';
const CENTER_CUTAWAY_PERCENTAGE = 30 / 184;
const CENTER_LOGO_PERCENTAGE = 38 / 184;
const QR_NATIVE_SIZE = 36;

// SWARM change (B3, 2026-09-29): the mark is wider than tall, so it spans the
// full width of the 36 x 36 logo square and is centred vertically in it.
const MARK_WIDTH = QR_NATIVE_SIZE;
const MARK_HEIGHT =
  (QR_NATIVE_SIZE * SWARM_MARK_VIEWBOX_HEIGHT) / SWARM_MARK_VIEWBOX_WIDTH;
const MARK_Y = (QR_NATIVE_SIZE - MARK_HEIGHT) / 2;

type ComputeResultType = Readonly<{
  path: string;
  moduleCount: number;
  radius: number;
}>;

function compute(link: string): ComputeResultType {
  const qr = QR(AUTODETECT_TYPE_NUMBER, ERROR_CORRECTION_LEVEL);
  qr.addData(link);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const center = moduleCount / 2;
  const radius = CENTER_CUTAWAY_PERCENTAGE * moduleCount;

  function hasPixel(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= moduleCount || y >= moduleCount) {
      return false;
    }

    const distanceFromCenter = Math.sqrt(
      (x - center + 0.5) ** 2 + (y - center + 0.5) ** 2
    );

    // Center and 1 dot away should remain clear for the logo placement.
    if (Math.ceil(distanceFromCenter) <= radius + 3) {
      return false;
    }

    return qr.isDark(x, y);
  }

  const path = [];
  for (let y = 0; y < moduleCount; y += 1) {
    for (let x = 0; x < moduleCount; x += 1) {
      if (!hasPixel(x, y)) {
        continue;
      }

      const onTop = hasPixel(x, y - 1);
      const onBottom = hasPixel(x, y + 1);
      const onLeft = hasPixel(x - 1, y);
      const onRight = hasPixel(x + 1, y);

      const roundTL = !onLeft && !onTop;
      const roundTR = !onTop && !onRight;
      const roundBR = !onRight && !onBottom;
      const roundBL = !onBottom && !onLeft;

      path.push(
        `M${2 * x} ${2 * y + 1}`,
        roundTL ? 'a1 1 0 0 1 1 -1' : 'v-1h1',
        roundTR ? 'a1 1 0 0 1 1 1' : 'h1v1',
        roundBR ? 'a1 1 0 0 1 -1 1' : 'v1h-1',
        roundBL ? 'a1 1 0 0 1 -1 -1' : 'h-1v-1',
        'z'
      );
    }
  }

  return {
    path: path.join(''),
    moduleCount,
    radius,
  };
}

export function BrandedQRCode({ size, link, color }: PropsType): JSX.Element {
  const { path, moduleCount, radius } = useMemo(() => compute(link), [link]);

  const QR_SCALE = size / 2 / moduleCount;

  const CENTER_X = size / 2;
  const CENTER_Y = size / 2;
  const LOGO_SIZE = CENTER_LOGO_PERCENTAGE * size;
  const LOGO_X = CENTER_X - LOGO_SIZE / 2;
  const LOGO_Y = CENTER_Y - LOGO_SIZE / 2;
  const LOGO_SCALE = LOGO_SIZE / QR_NATIVE_SIZE;

  return (
    <>
      <g transform={`scale(${QR_SCALE} ${QR_SCALE})`}>
        <path d={path} fill={color} />

        <circle
          cx={moduleCount}
          cy={moduleCount}
          r={radius * 2}
          stroke={color}
          strokeWidth={2}
        />
      </g>

      <g
        transform={`translate(${LOGO_X} ${LOGO_Y}) scale(${LOGO_SCALE} ${LOGO_SCALE})`}
      >
        <svg
          x={0}
          y={MARK_Y}
          width={MARK_WIDTH}
          height={MARK_HEIGHT}
          overflow="visible"
          viewBox={`0 0 ${SWARM_MARK_VIEWBOX_WIDTH} ${SWARM_MARK_VIEWBOX_HEIGHT}`}
        >
          {SWARM_MARK_PATHS.map(d => (
            <path key={d.slice(0, 16)} fill={color} d={d} />
          ))}
        </svg>
      </g>
    </>
  );
}
