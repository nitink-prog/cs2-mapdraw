# Agent Guidance

- When implementing or changing UI features, support both desktop and mobile layouts.
- Treat `768px` horizontal width and below as the mobile mode unless the product requirements explicitly change that breakpoint.
- Verify that controls remain reachable and usable in both modes, especially map selection, drawing tools, color selection, clear actions, undo/redo, zoom, and Konva stage sizing.
- Preserve nearby `@ink:*` context comments. Update them when behavior changes so future agents can trust them.
