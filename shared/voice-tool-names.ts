/** Native Realtime tools use the same catalog on the server and data-channel client. */
export const VOICE_TOOL_NAMES = [
  'native_controls', 'recall_room', 'read_room', 'add_note', 'set_timer', 'create_widget', 'patch_object', 'remove_object',
  'read_canvas', 'apply_canvas', 'add_capability', 'research_sources', 'generate_image', 'search_web', 'search_images', 'import_image',
  'control_video', 'add_video', 'start_work', 'ask_canvas',
] as const;
export type VoiceToolName = typeof VOICE_TOOL_NAMES[number];
