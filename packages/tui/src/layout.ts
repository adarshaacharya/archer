export interface TuiLayout {
  framePadding: number;
  frameRowGap: number;
  headerMinHeight: number;
  approvalMinHeight: number;
  summaryMinHeight: number;
  maxStepsVisible: number;
}

export const defaultTuiLayout: TuiLayout = {
  framePadding: 1,
  frameRowGap: 1,
  headerMinHeight: 3,
  approvalMinHeight: 3,
  summaryMinHeight: 3,
  maxStepsVisible: 50,
};
