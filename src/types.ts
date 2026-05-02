export type Position = { x: number; y: number };

export type ScenarioId =
  | 'free'
  | 'intercept090'
  | 'track270out'
  | 'crossStation'
  | 'parallelCorrect';

export interface ScenarioPreset {
  id: ScenarioId;
  label: string;
  description: string;
  initial: {
    aircraft: Position;
    heading: number;
    airspeed: number;
    obs: number;
    windFrom: number;
    windSpeed: number;
  };
  interceptRadial?: number;
  interceptMode?: 'INBOUND' | 'OUTBOUND';
}
