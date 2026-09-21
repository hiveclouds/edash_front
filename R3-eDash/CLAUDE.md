# FR Dashboard Development Instructions

## Project

This is the FR Dashboard web application.

The application should prioritize:
- clarity
- information hierarchy
- operational usability
- responsive behavior
- accessibility
- maintainability

## Before changing code

Always inspect the existing implementation before making changes.

Understand the relationship between:
- HTML
- CSS
- JavaScript
- existing components
- existing data
- existing interactions

Do not redesign something without understanding how it currently works.

## Preserve functionality

Do not remove or silently change existing functionality.

Preserve:
- existing business logic
- existing data
- existing API behavior
- existing navigation
- existing JavaScript behavior
- existing dependencies

Do not introduce a new framework unless explicitly requested.

## Anti-slop

Use the available Anti-slop skills for frontend work.

Avoid generic AI-generated UI patterns such as:
- excessive cards
- unnecessary gradients
- decorative elements without purpose
- fake statistics
- fake metrics
- meaningless badges
- excessive icons
- non-functional buttons
- unnecessary animations
- excessive visual effects
- repetitive layouts

Every UI element should have a clear purpose.

Do not make the interface more complicated simply to make it look more sophisticated.

## Data integrity

Never invent:
- metrics
- statistics
- operational values
- telemetry
- user activity
- performance numbers

Use real application data.

If data is unavailable, represent the unavailable state honestly.

## Responsive

All changes must work on:
- desktop
- laptop
- tablet
- mobile

Do not simply shrink desktop layouts.

Use appropriate reflow, stacking, scrolling, and interaction patterns.

## Accessibility

Consider:
- keyboard navigation
- focus states
- readable contrast
- loading states
- empty states
- error states
- disabled states

## Scope

Modify only files necessary for the requested task.

Do not perform unrelated refactoring.

## Testing

After modifying code:

1. check for errors
2. test affected interactions
3. check navigation
4. check loading/error/empty states
5. check responsive behavior
6. run the Anti-slop Delivery Gate
7. report files changed
8. report tests performed
9. report remaining issues
