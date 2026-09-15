// Shared question classification. Presentation filtering never changes case state.
export type AskIntent = "status" | "equipment" | "buddy" | "compliance" | "owner" | "date_question" | "unmatched" | "access" | "profile" | "manager" | "joiner";

export function askIntentFor(question: string): AskIntent {
  const text = question.toLowerCase();
  if (/(what changes if|what if|would happen if|impact of)/i.test(text) && /(laptop|equipment|\beta\b|delivery|loaner)/i.test(text)) return "equipment";
  if (/(what changes if|what if|would happen if|impact of)/i.test(text) && /(start|date|first day)/i.test(text)) return "date_question";
  if (/(when does .* start|what('?s| is)? (her|his|their|the) start date|start date\?|which day does .* start|when is (her|his|their|the) first day)/i.test(text)) return "date_question";
  if (/(compliance|right to work|i-9|i9|works council|social insurance|\brtw\b)/i.test(text)) return "compliance";
  if (/(buddy|new starter support|\breplied\b|\bresponded\b|\baccepted\b|\bdeclined\b)/i.test(text)) return "buddy";
  if (/(laptop|equipment|\beta\b|delivery|loaner|\bsorted\b|macbook|\bnudge\b|\bsent\b|\bapproved\b|\bit reply|\bit replied)/i.test(text)) return "equipment";
  if (/(\bowner\b|who is responsible|who owns)/i.test(text)) return "owner";
  if (/(profile|hris|personal details|set.?up.*record)/i.test(text)) return "profile";
  if (/(\baccess\b|accounts?|applications?|apps? .*need|log.?in)/i.test(text)) return "access";
  if (/(manager|first.day plan|coordinate|coordination)/i.test(text)) return "manager";
  if (/(new joiner questions|new starter questions|what (time|should i bring)|where (do|should) i|first day.*(expect|bring)|expect.*first day|who (do|should) i (contact|ask)|i.m (joining|starting))/i.test(text)) return "joiner";
  if (/(what('?s| is|s)? left|remaining|before day one|\btasks?\b|readiness|\bready\b|\bstatus\b|\bsummary\b|\bupdate\b|outstanding|blocking|blocker|\boverdue\b|\blate\b|\brisks?\b|deadlines?|good to go|\bdone\b|on track|progress)/i.test(text)) return "status";
  return "unmatched";
}
