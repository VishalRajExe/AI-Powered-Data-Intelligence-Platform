Produce the final structured result for this objective, as JSON only.

## Objective

{topic}

## Schema your result must satisfy

{schema}

## Required fields

{checklist}

## Expected number of records

{expected_records}

## Evidence gathered during this run

{transcript}

## Rules

1. Output one JSON object that conforms exactly to the schema above. No prose, no code
   fences, no commentary.
2. Every value must be supported by the evidence above. If a field has no support, omit
   it rather than guessing — an omitted field will be reported as missing, an invented one
   will be reported as verified data and propagate.
3. Do not add fields the schema does not declare.
4. Do not merge two distinct entities into one record, and do not pad the result by
   repeating one entity under different names.
5. Record counts matter: if fewer entities are evidenced than expected, return the ones
   you can support.
