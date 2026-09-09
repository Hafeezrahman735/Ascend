/**
 * Maximum width of the signed-out screens' content column.
 *
 * The auth screens are a centred ScrollView with horizontal padding, which on a
 * phone is exactly right and on an iPad stretched a login form across 1024pt —
 * text fields a foot wide, and a consent checkbox marooned from the label it
 * belongs to. App Review tests on an iPad Air, so this is not hypothetical.
 *
 * 420 is a little wider than the largest phone, so nothing changes on the device
 * most people hold, and the form reads as a form on a tablet.
 */
export const AUTH_CONTENT_MAX_WIDTH = 420;
