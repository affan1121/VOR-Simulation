import type { ScenarioPreset } from './types';

/** Preset training scenarios — initial conditions only; pilot flies manually or uses intercept aid. */
export const SCENARIOS: ScenarioPreset[] = [
  {
    id: 'free',
    label: 'Free play',
    description: 'Default start 8 NM north of the VOR, heading south toward the station.',
    initial: {
      aircraft: { x: 0, y: 8 },
      heading: 180,
      airspeed: 120,
      obs: 360,
      windFrom: 360,
      windSpeed: 0,
    },
  },
  {
    id: 'intercept090',
    label: 'Intercept 090 inbound',
    description:
      'Start northwest of the field. Set OBS to 090 and use intercept guidance to join the 090 radial inbound.',
    initial: {
      aircraft: { x: -6, y: 6 },
      heading: 135,
      airspeed: 120,
      obs: 90,
      windFrom: 300,
      windSpeed: 15,
    },
    interceptRadial: 90,
    interceptMode: 'INBOUND',
  },
  {
    id: 'track270out',
    label: 'Track 270 outbound',
    description:
      'East of the VOR on the 090 radial. Fly outbound on the 270 course (OBS 270, FROM flag).',
    initial: {
      aircraft: { x: 10, y: 0 },
      heading: 270,
      airspeed: 110,
      obs: 270,
      windFrom: 180,
      windSpeed: 12,
    },
    interceptRadial: 270,
    interceptMode: 'OUTBOUND',
  },
  {
    id: 'crossStation',
    label: 'Cross station — TO/FROM',
    description:
      'Direct overflight path to observe station passage, cone of confusion, and TO/FROM reversal.',
    initial: {
      aircraft: { x: -0.2, y: 6 },
      heading: 180,
      airspeed: 90,
      obs: 360,
      windFrom: 360,
      windSpeed: 0,
    },
  },
  {
    id: 'parallelCorrect',
    label: 'Parallel radial — correct back',
    description:
      'Offset slightly west of the 180 radial southbound; practice intercepting back onto course.',
    initial: {
      aircraft: { x: -3, y: -12 },
      heading: 360,
      airspeed: 115,
      obs: 180,
      windFrom: 270,
      windSpeed: 8,
    },
    interceptRadial: 180,
    interceptMode: 'OUTBOUND',
  },
];
