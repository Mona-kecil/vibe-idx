# Glossary

`GLOSSARY.md` holds this project's language. Read it before acting on a request that names a part of the product.

- If the user uses a term that conflicts with the glossary, or a word listed under `_Avoid_`, stop and name the conflict before you write code: "The glossary defines X as A, but you seem to mean B. Which is it?" Do not reinterpret silently.
- If the code contradicts the glossary, say so before changing either.
- When a term is settled, update `GLOSSARY.md` in the same change.
- Format: `**Term**:`, then one or two sentences on what it is, then `_Avoid_:` with the rejected synonyms. When multiple words exist for one concept, pick one and list the rest under `_Avoid_`.
- Add only terms specific to this project. Leave out general programming concepts and implementation details such as file paths, function names and storage keys.

# Design principles

## UI/UX

- Avoid unnecessary secondary labels and descriptions. Avoid UI separators such as the dot or slash or any other separator. Let the layout do the explaining.
- Every element must serve a clear user purpose; no slogans, decoration, nested cards, or repeated info.
- Show explanations only for abnormal states or required actions; put secondary details behind progressive disclosure.

Keep units, reporting dates, and material uncertainty where they affect interpretation. Put supporting source details in tooltips or source views instead of repeating them throughout the page.

Use charts for values that change over time. Keep exact values and source records available for inspection.
