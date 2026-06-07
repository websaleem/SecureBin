export type BinCategory = 'green' | 'yellow' | 'red' | 'white' | 'purple' | 'blue' | 'orange' | 'grey';

export type CategorizationResult = {
  bin: BinCategory;
  item: string;
  reason: string;
  confidence: number;
};

export type ScanRecord = {
  id: string;
  timestamp: number;
  imageUri: string;
  bin: BinCategory;
  item: string;
  reason: string;
  confidence: number;
};
