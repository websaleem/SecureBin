import { BinCategory } from '../types';

export type BinDefinition = {
  label: string;
  color: string;
  textColor: string;
  borderColor?: string;
  description: string;
  examples: string;
  dropOff?: string;
};

export const BINS: Record<BinCategory, BinDefinition> = {
  red: {
    label: 'Red Bin',
    color: '#F44336',
    textColor: '#ffffff',
    description: 'General Waste / Landfill',
    examples: 'Contaminated packaging, nappies, broken ceramics, soft plastics (most councils), non-recyclable waste',
  },
  yellow: {
    label: 'Yellow Bin',
    color: '#FFC107',
    textColor: '#212121',
    description: 'Mixed Recycling',
    examples: 'Clean paper, cardboard, hard plastics, aluminium & steel cans, glass bottles & jars (where no separate glass bin)',
  },
  green: {
    label: 'Green Bin',
    color: '#4CAF50',
    textColor: '#ffffff',
    description: 'Organics / FOGO',
    examples: 'Food scraps, fruit & vegetables, garden waste, grass clippings, leaves, branches, uncoated paper towels',
  },
  white: {
    label: 'White Bin',
    color: '#FFFFFF',
    textColor: '#212121',
    borderColor: '#BDBDBD',
    description: 'Glass Only',
    examples: 'Glass bottles, jars & containers — kerbside glass-only stream (select councils, common for CDS returns in SA/NT)',
  },
  purple: {
    label: 'Purple Bin',
    color: '#9C27B0',
    textColor: '#ffffff',
    description: 'Glass (New AS4123)',
    examples: 'Glass bottles, jars & containers — newer glass-only kerbside bin rolling out in Victoria (CRS) and parts of NSW',
  },
  blue: {
    label: 'Blue Bin',
    color: '#2196F3',
    textColor: '#ffffff',
    description: 'Drop-Off Required',
    examples: 'E-waste (computers, phones, TVs), batteries (all types), soft plastics, household chemicals, paint',
    dropOff: 'Not kerbside — take to a council collection point, Officeworks (e-waste), REDcycle drop-off, or ChemClear (chemicals).',
  },
  orange: {
    label: 'Orange Bin',
    color: '#FF9800',
    textColor: '#ffffff',
    description: 'Reuse / Donate',
    examples: 'Clothes, shoes, working electronics, furniture, books, toys — still has life left. Donate to a charity bin, op shop, or list on a marketplace.',
  },
  grey: {
    label: 'Grey Bin',
    color: '#9E9E9E',
    textColor: '#212121',
    description: 'Unsure / Ask Council',
    examples: 'Classification is ambiguous — check with your local council for the correct disposal method for this item.',
  },
};
