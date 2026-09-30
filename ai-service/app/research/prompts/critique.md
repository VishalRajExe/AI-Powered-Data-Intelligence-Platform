Evaluate whether the extracted result below is complete and adequately evidenced.

## Objective

{topic}

## Data contract it must satisfy (JSON Schema)

{schema}

## Fields required by the contract

{checklist}

## Expected number of records

{expected_records}

## Sources actually retrieved during this run, with what was read from each

{sources}

## Proposed result

{result}

## Judgement rules

- `is_satisfactory` is true only if every required field is present, non-empty, and
  attributable to content quoted in one of the sources above — not merely to a URL that was
  retrieved. A value that appears in no source's content is a fabrication, however plausible.
- A source marked "search snippet only, the page itself was never read" supports nothing beyond
  what that snippet literally states.
- A browser session reported as `UNCHANGED` or `UNKNOWN` did not demonstrably alter the page. If a
  value exists only after such an action, the submission is not satisfactory: say so, and instruct
  the run to read a source that states the value or to try a different action.
- Fewer records than expected, or records that are near-duplicates of one entity, is not
  satisfactory.
- The "field names appearing in that text" line tells you where to look, not what is true: a field
  name present in prose does not mean any record's value was read there, and a name absent from
  every source is strong evidence the value was invented.
- When you answer false you must give concrete `improvement_instructions`: name the
  missing fields, name the source each should be taken from, and if more evidence is needed
  say what to search for or which kind of page to read. Never return false with empty
  instructions.
- Give at least three distinct reasons. Do not summarise the result approvingly instead
  of checking it.
