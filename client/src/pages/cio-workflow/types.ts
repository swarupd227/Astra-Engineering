// Shared types for cio-workflow components

export type SDLCStage = 'BRD' | 'Design' | 'CodeGen' | 'Deploy' | 'QA';
export type StageStatus = 'locked' | 'active' | 'review' | 'completed';

export interface StageState {
  status: StageStatus;
  data?: any;
}
