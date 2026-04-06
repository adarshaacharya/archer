export interface TuiLayout {
  framePadding: number;
  frameRowGap: number;
  headerMinHeight: number;
  approvalMinHeight: number;
  summaryMinHeight: number;
  maxStepsVisible: number;
}

export const defaultTuiLayout: TuiLayout = {
  framePadding: 0,
  frameRowGap: 0,
  headerMinHeight: 1,
  approvalMinHeight: 3,
  summaryMinHeight: 3,
  maxStepsVisible: 50,
};
