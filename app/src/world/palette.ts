// Environment colours. Warm, matte, low saturation so that the terracotta
// accent and UI signage stay the loudest things in the frame (DESIGN.md).
export const ENV = {
  ground: 0x93a57d,
  slab: 0x6f6252,
  wallInterior: 0xf1e7d3,
  wallExterior: 0xe2d3b6,
  wallCap: 0x2f5a45,
  wood: 0xb88a5d,
  woodDark: 0x7d5a3c,
  woodLight: 0xd8b98f,
  fabricCream: 0xeadfc8,
  fabricGreen: 0x4f7a5f,
  fabricSage: 0x9cb197,
  fabricTerracotta: 0xc0643f,
  fabricMustard: 0xd6a646,
  fabricBlue: 0x6f8fa6,
  metal: 0x5d625f,
  metalLight: 0xa7aca6,
  screen: 0x1f2a2b,
  screenGlow: 0x8fc7c2,
  plantLeaf: 0x5f8f4e,
  plantLeafDark: 0x41704a,
  pot: 0xc98a62,
  white: 0xf7f3ea,
  felt: 0x2f7a57,
  glass: 0xcfe3e0,
  rubber: 0x3e4a44,
  paper: 0xf4eedf,
  accent: 0xc0643f,
} as const;

export const FINISH_COLOR: Record<string, number> = {
  'karpet tile matte': 0xd8c8ab,
  'vinyl motif kayu': 0xc9a27a,
  'vinyl anti-statik (target)': 0xb7c0b0,
  'keramik anti-slip': 0xe6dfd1,
  'deck komposit': 0xa98058,
  'lantai karet olahraga': 0x6b7a70,
  epoxy: 0xcbc3b4,
  '-': 0x8b8172,
};

// Category tint mixed into floor colour so zones read at a glance.
export const CATEGORY_TINT: Record<string, number> = {
  circulation: 0xe9dcc4,
  shaft: 0x6f6252,
  restricted: 0xb3a99a,
};

export const ARTWORK: Record<string, [number, number, number]> = {
  'ART-01': [0x2f5a45, 0xeadfc8, 0xc0643f],
  'ART-02': [0xd6a646, 0x2f5a45, 0xf7f3ea],
  'ART-03': [0x6f8fa6, 0xf1e7d3, 0xc0643f],
  'ART-04': [0x4f7a5f, 0xd8b98f, 0x2f5a45],
  'ART-05': [0xc0643f, 0xf7f3ea, 0x4f7a5f],
  'ART-06': [0xeadfc8, 0x6f8fa6, 0xd6a646],
  'ART-07': [0x2f5a45, 0xd6a646, 0xf7f3ea],
  'ART-08': [0x9cb197, 0x2f5a45, 0xc0643f],
  'ART-09': [0xd6a646, 0xc0643f, 0x2f5a45],
  'ART-10': [0x6f8fa6, 0xeadfc8, 0x4f7a5f],
  'ART-11': [0xc0643f, 0x2f5a45, 0xeadfc8],
};
