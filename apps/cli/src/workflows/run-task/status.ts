export function turnStatusLabel(stateName: string): string {
  switch (stateName) {
    case "routing":
      return "Routing turn";
    case "researching":
      return "Gathering context";
    case "planning":
      return "Planning";
    case "implementing":
      return "Implementing";
    case "verifying":
      return "Verifying";
    case "repairing":
      return "Repairing";
    case "compacting":
      return "Compacting context";
    default:
      return "Processing task";
  }
}
