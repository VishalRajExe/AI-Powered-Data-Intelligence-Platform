Evaluate whether the extracted result below is complete and adequately evidenced.

## Objective

{topic}

## Data contract it must satisfy (JSON Schema)

{schema}

## Fields required by the contract

{checklist}

## Expected number of records

{expected_records}

## Sources actually retrieved during this run

{sources}

## Proposed result

{result}

## Judgement rules

- `is_satisfactory` is true only if every required field is present, non-empty, and
  attributable to one of the retrieved sources above.
- A value that appears in no retrieved source is a fabrication, however plausible.
- Fewer records than expected, or records that are near-duplicates of one entity, is not
  satisfactory.
- When you answer false you must give concrete `improvement_instructions`: name the
  missing fields, and if more evidence is needed say what to search for or which kind of
  page to read. Never return false with empty instructions.
- Give at least three distinct reasons. Do not summarise the result approvingly instead
  of checking it.
