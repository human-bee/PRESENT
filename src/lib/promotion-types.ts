export type PromotableContentType = 'image' | 'text' | 'url' | 'embed';

export interface PromotableItem {
  id: string;
  type: PromotableContentType;
  data: {
    url?: string; // For image, url, embed
    text?: string; // For text
    width?: number; // Optional dimensions
    height?: number;
    title?: string; // For bookmarks/embeds
  };
  label: string; // Human-readable description (e.g., "Generated Chart", "Source Link")
}

export interface PromotableRegistry {
  items: PromotableItem[];
}
