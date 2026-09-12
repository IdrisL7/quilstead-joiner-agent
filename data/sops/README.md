# SOPs (skills) the agent follows

Each file is a skill in the SKILL.md shape: `name` and `description` in front matter are
what the agent sees at the start of a case; the body is loaded only for the country that
applies (progressive disclosure). In production these are owned and edited by the People
team, not by engineering. The deadlines named here are computed by code in
`lib/policy/deadlines.ts`; the SOP explains them, it does not define them.
