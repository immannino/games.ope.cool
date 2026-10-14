// Board definitions. Every coordinate here is in pixels of the original
// backdrop image (origin top-left, y down). Hole centers were extracted from the
// artwork with a dark-blob + Hough-circle pass and hand-checked, including holes
// that are partly hidden behind glass art (frame, lady, instruction card).

const HOLE_DIAMETER_M = 0.030; // real playfield holes are ~1.2" across

export const BOARDS = {
  icb: {
    id: 'icb',
    name: 'Ice Cold Beer',
    image: 'backdrops/ice-cold-beer.png',
    holeRadiusPx: 23.5,
    holeColor: '#120f04',
    poleX: [125, 900], // vertical guide rods the bar carriages ride on
    poleBottomY: 1495, // rails run down to the bottom of the playfield
    barRangeY: [1470, 315], // bar axis: bottom (rest, just above where the rails end) .. top limit
    playfieldTop: 262,
    // the ball comes back up out of the hole under the bar's rest position
    feedHole: [810.3, 1199.8],
    // The printed instruction card and START sign cover the lower playfield.
    // They are erased and the real hole layout (from a photo of an actual
    // cabinet, mapped onto this art) is rebuilt underneath; see cleanboard.js.
    rebuild: {
      erase: [[379, 840, 282, 108], [229, 908, 584, 312]], // x, y, w, h
      donor: [240, 1228, 530, 48], // clean strip to borrow bubble texture from
      holeSprite: [535.6, 688.6, 22.5], // a clean reference hole: x, y, r
      ringSprite: [534.8, 581.4, 31, 22], // target 7 ring: x, y, radius, number offset
    },
    // art has a bar printed on it; inpaint it out (column interpolation)
    patches: [
      { x0: 129, x1: 237, y0: 1118, y1: 1142 },
      { x0: 801, x1: 895, y0: 1126, y1: 1150 },
    ],
    holes: [
      [488.9, 302.3], [659.5, 318.9], [531.9, 345.8], [442.9, 345.9], [356.9, 347.2], [615, 363], [704.7, 363],
      [255.5, 367.4], [859.8, 389.5], [488.1, 389.8], [399.9, 391.2], [749.2, 406.2], [660.2, 406.9], [572.7, 407.7],
      [298.6, 428.1], [444.4, 436.7], [238.1, 447.6], [706.1, 451.7], [536.3, 476.6], [659.5, 494.7], [380.3, 508.6],
      [212.6, 510.5], [295.7, 512], [588.1, 528.2], [483, 530.6], [758.6, 543], [237.3, 572.9], [359.2, 572.9],
      [534.8, 581.4], [652.9, 582.2], [431.2, 583.7], [297.7, 597], [811.1, 597.8], [482.3, 636.1], [588.7, 636.1],
      [653, 651.8], [410.9, 677.7], [535.6, 688.6], [706.1, 705], [352.5, 729.2], [181.9, 730], [758.6, 755.9],
      [280.4, 760.6], [554.4, 790.3], [212.5, 791.1], [412.2, 791.1], [343.8, 816.1], [811.1, 827.9], [268, 879.6],
      [173.1, 1037.7], [865, 1094.1],
      // partially hidden / not caught by the blob pass
      [758, 650], [400, 305], [157, 538], [149, 669], [147, 952], [599, 828], [666, 835], [887, 945],
      [817, 1020], [887, 1027], [220, 1108], [885, 583], [860, 650], [845, 710],
      // under the instruction card, from the cabinet photo
      [489.3, 861.3], [389.1, 865.7], [445.2, 908.7], [722, 918], [523.2, 946], [322.3, 963.4], [260.5, 1010.8],
      [634.5, 1013.8], [709, 1044.6], [518.9, 1049.1], [422.1, 1079.2], [332.8, 1083], [778.4, 1085.1],
      [622.6, 1094.4], [650.4, 928.1], [521, 1128.6],
    ],
    // target hole centers, index 0 = hole #1 ... index 9 = hole #10
    targets: [
      [521, 1128.6], [778.4, 1085.1], [260.5, 1010.8], [650.4, 928.1], [412.2, 791.1],
      [758, 650], [534.8, 581.4], [295.7, 512], [660.2, 406.9], [442.9, 345.9],
    ],
    display: {
      ball: { x: 273, y: 1301, w: 15, h: 28 },
      ballOnBar: { x: 333, y: 1315, r: 23 },
      bonus: { x: 265, y: 1368, w: 15, h: 30, pitch: 24, digits: 3, plate: [258, 1362, 90, 42] },
      score: { x: 273, y: 1437, w: 14, h: 30, pitch: 22.3, digits: 4, plate: [262, 1432, 100, 40] },
      gameOver: { x: 160, y: 1430, w: 64, h: 42 },
      tilt: { x: 160, y: 1308, w: 64, h: 22 },
      lamps: [[246, 1353, 8], [246, 1422, 8]],
      panelColor: '#e9c21a',
    },
  },

  zeke: {
    id: 'zeke',
    name: "Zeke's Peak",
    image: 'backdrops/zekes-peak.jpeg',
    holeRadiusPx: 7.7,
    holeColor: '#0b0b0d',
    poleX: [44, 302],
    poleBottomY: 512,
    barRangeY: [504, 117], // bar axis: bottom (rest, just above where the rails end) .. top limit
    playfieldTop: 98,
    feedHole: [270.4, 413],
    // the printed bar here is a thin sloped line
    linePatches: [{ x0: 40, y0: 436, x1: 305, y1: 451, half: 4 }],
    // Zeke's Peak is a re-themed Ice Cold Beer: same playfield, ~1/3 scale in this
    // image (holes match to ~1px). The medallions and instruction card hide the
    // lower holes, so they are erased and the Ice Cold Beer layout is mapped in.
    rebuild: {
      erase: [[62, 264, 228, 98], [85, 355, 180, 78]], // x, y, w, h
      donor: [140, 456, 150, 38],
      holeSprite: [128.5, 182.1, 7.5],
      ringSprite: [179.3, 206, 11, 13, 4], // target 7 ring: x, y, radius, number offset, number half width
      numberColor: 'rgba(235,240,248,0.9)',
    },
    holes: [
      [164.4, 113.5], [134.8, 113.6], [220.5, 118.6], [178.7, 127.8], [121.2, 128.5], [235.3, 133.4], [205.6, 133.8],
      [87.5, 134.8], [52.5, 135.7], [286.3, 142.3], [164, 142.6], [134.7, 143.1], [250.1, 148.1], [220.4, 148.3],
      [191.9, 148.5], [101.5, 155.5], [149.7, 158.2], [81.7, 162], [235.8, 163.2], [179.9, 171.5], [220.3, 177.5],
      [100.4, 181.9], [128.5, 182.1], [73.4, 182.8], [196.8, 189], [162.5, 189.7], [55.6, 191.9], [253.4, 194],
      [81.4, 203.8], [121.6, 203.8], [179.3, 206], [218.4, 207.1], [145.3, 207.3], [297, 210.7], [101.5, 211.8],
      [270.5, 211.9], [162.2, 225], [197.2, 225], [253, 230], [218.4, 230.1], [287.4, 231.1], [51.2, 235.2],
      [138.4, 238.9], [179.9, 242.4], [235.8, 247.6], [281.7, 250.4], [65.1, 255.9], [119.4, 256.1], [72.4, 275.8],
      [297.4, 329.9], [51.7, 330.1], [297.6, 357.6], [60.3, 359], [288.1, 378.1], [77.3, 384.6],
      // partially hidden
      [150, 127], [96, 263], [270, 356],
      // hidden under the medallions / card, mapped from the Ice Cold Beer layout
      [253.5, 265.7], [186.1, 276.9], [139.3, 276.9], [116.7, 285.1], [270.8, 290], [91.8, 306.3], [200.9, 289.6],
      [223, 292.1], [164.7, 300.6], [131.7, 301.9], [150.2, 316.4], [241.5, 320.1], [176, 329.1], [109.7, 334.5],
      [89.4, 350.3], [212.7, 352.1], [237.3, 362.5], [174.6, 363.7], [142.7, 373.6], [113.2, 374.7], [260.2, 376.3],
      [208.8, 379.1], [217.9, 323.3], [175.3, 390.4],
    ],
    targets: [
      [175.3, 390.4], [260.2, 376.3], [89.4, 350.3], [217.9, 323.3], [139.3, 276.9],
      [253, 230], [179.3, 206], [100.4, 181.9], [220.4, 148.3], [150, 127],
    ],
    display: {
      ball: { x: 92, y: 446, w: 7, h: 12 },
      ballOnBar: { x: 111, y: 452.5, r: 5.6 },
      bonus: { x: 91, y: 470, w: 6.5, h: 10, pitch: 8.5, digits: 3, plate: [89, 468, 28, 14] },
      score: { x: 90, y: 492, w: 6.5, h: 11, pitch: 9, digits: 4, plate: [88, 490, 39, 15] },
      gameOver: { x: 56, y: 489, w: 20, h: 16 },
      tilt: { x: 55, y: 448, w: 20, h: 8 },
      lamps: [[85, 464, 2.5], [85, 487, 2.5]],
      panelColor: '#f1efe6',
    },
  },
};

// meters per image pixel, chosen so the art's holes come out at real size
export function metersPerPixel(board) {
  return HOLE_DIAMETER_M / 2 / board.holeRadiusPx;
}
