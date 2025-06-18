# 🎯 PresentationDeck Component

A feature-complete, professional presentation tool built for the Tambo ecosystem. Display beautiful, almost full-screen PowerPoint, Google Slides, PDF, and image-based presentations with comprehensive navigation, interactive features, and seamless canvas integration.

## ✨ Features

### 🎮 Navigation & Controls
- **Hotkey Controls**: Full keyboard navigation with intuitive shortcuts
- **Mouse Navigation**: Click-based controls with visual feedback
- **Thumbnail Sidebar**: Visual slide navigation with jump-to functionality
- **Progress Tracking**: Real-time progress bar with elapsed time display
- **Auto-advance**: Configurable automatic slide progression

### 🖱️ Interactive Features
- **Laser Pointer**: Interactive red dot pointer that follows mouse movement
- **Bookmarking**: Mark important slides for quick reference
- **Speaker Notes**: Toggle-able presenter notes for each slide
- **Fullscreen Mode**: Immersive presentation experience
- **Multiple Aspect Ratios**: Support for 16:9, 4:3, and 16:10 formats

### 🎨 Professional Styling
- **Beautiful Design**: Modern, clean interface with smooth animations
- **Dark/Light Themes**: Adaptable to different presentation contexts
- **Responsive Layout**: Adapts to different screen sizes and canvas dimensions
- **Glass Morphism Effects**: Modern backdrop blur and transparency effects

### 🔧 Tambo Integration
- **Canvas Aware**: Seamless integration with Tambo canvas system
- **State Persistence**: Maintains presentation state across sessions
- **Event Handling**: Responds to canvas focus, resize, and interaction events
- **Component Registry**: Fully registered Tambo component with AI control

## 🚀 Quick Start

### Basic Usage

```tsx
import { PresentationDeck } from "@/components/ui/presentation-deck";

const slides = [
  {
    id: "slide-1",
    title: "Welcome",
    content: "<h1>Hello World</h1>",
    notes: "Welcome to our presentation",
    duration: 30
  },
  // ... more slides
];

<PresentationDeck
  title="My Presentation"
  slides={slides}
  author="Your Name"
  aspectRatio="16:9"
  showControls={true}
  enableLaserPointer={true}
/>
```

### Advanced Configuration

```tsx
<PresentationDeck
  title="Advanced Business Presentation"
  slides={slides}
  author="John Doe"
  aspectRatio="16:9"
  theme="dark"
  showControls={true}
  showProgress={true}
  showNotes={false}
  enableLaserPointer={true}
  autoAdvance={false}
  autoAdvanceInterval={45}
  totalDuration={30}
  tags={["business", "quarterly", "results"]}
  createdAt="2024-01-15T10:00:00Z"
  sourceType="powerpoint"
  sourceUrl="https://example.com/presentation.pptx"
/>
```

## 🎹 Keyboard Shortcuts

| Shortcut | Action | Description |
|----------|--------|-------------|
| `←` `→` | Navigate | Previous/Next slide |
| `Space` | Next | Advance to next slide |
| `n` `j` | Next | Alternative next slide |
| `p` `k` | Previous | Alternative previous slide |
| `Home` | First | Jump to first slide |
| `End` | Last | Jump to last slide |
| `Enter` | Play/Pause | Toggle auto-advance |
| `F` `F11` | Fullscreen | Enter fullscreen mode |
| `Esc` | Exit | Exit fullscreen |
| `T` | Thumbnails | Toggle thumbnail sidebar |
| `S` | Notes | Toggle speaker notes |
| `L` | Laser | Activate laser pointer |
| `B` | Bookmark | Bookmark current slide |
| `R` | Reset | Return to first slide |

## 📊 Schema Definition

### Slide Schema
```typescript
const slideSchema = z.object({
  id: z.string(),                    // Unique identifier
  title: z.string().optional(),      // Slide title
  content: z.string().optional(),    // HTML/Markdown content
  imageUrl: z.string().optional(),   // Direct image URL
  thumbnailUrl: z.string().optional(), // Thumbnail URL
  notes: z.string().optional(),      // Speaker notes
  duration: z.number().optional(),   // Suggested duration (seconds)
  transition: z.enum(["fade", "slide", "zoom", "flip"]).optional()
});
```

### Presentation Schema
```typescript
const presentationDeckSchema = z.object({
  title: z.string(),                 // Presentation title
  slides: z.array(slideSchema),      // Array of slides
  sourceType: z.enum([               // Source format
    "powerpoint", "google-slides", 
    "pdf", "images", "html", "markdown"
  ]).optional(),
  sourceUrl: z.string().optional(),  // Original URL
  aspectRatio: z.enum(["16:9", "4:3", "16:10"]).optional(),
  theme: z.enum(["dark", "light", "auto"]).optional(),
  autoAdvance: z.boolean().optional(),
  autoAdvanceInterval: z.number().optional(),
  showControls: z.boolean().optional(),
  showProgress: z.boolean().optional(),
  showNotes: z.boolean().optional(),
  enableLaserPointer: z.boolean().optional(),
  totalDuration: z.number().optional(),
  author: z.string().optional(),
  createdAt: z.string().optional(),
  tags: z.array(z.string()).optional()
});
```

## 🎨 Styling & Theming

The component uses Tailwind CSS classes and can be customized through:

### Color Themes
- **Dark Theme**: Slate color palette with high contrast
- **Light Theme**: Light background with dark text
- **Auto Theme**: Adapts based on system preference

### Custom Styling
```css
/* Override component styles */
.presentation-deck {
  --bg-primary: theme('colors.slate.950');
  --bg-secondary: theme('colors.slate.900');
  --text-primary: theme('colors.white');
  --accent-color: theme('colors.blue.400');
}
```

## 🔌 Integration Examples

### With Image Slides
```tsx
const imageSlides = [
  {
    id: "slide-1",
    imageUrl: "https://example.com/slide1.jpg",
    thumbnailUrl: "https://example.com/thumb1.jpg",
    title: "Slide 1",
    notes: "This is the first slide"
  }
];
```

### With HTML Content
```tsx
const htmlSlides = [
  {
    id: "slide-1",
    title: "Rich Content",
    content: `
      <div class="text-center">
        <h1 class="text-4xl font-bold mb-6">Welcome</h1>
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-blue-100 p-4 rounded">Feature 1</div>
          <div class="bg-green-100 p-4 rounded">Feature 2</div>
        </div>
      </div>
    `,
    notes: "Demonstrate rich HTML content capabilities"
  }
];
```

### With Auto-advance
```tsx
<PresentationDeck
  title="Auto-advancing Presentation"
  slides={slides}
  autoAdvance={true}
  autoAdvanceInterval={10} // 10 seconds per slide
  showProgress={true}
/>
```

## 🎯 Use Cases

### Business Presentations
- Quarterly reports and business reviews
- Sales pitches and product demos
- Training sessions and workshops
- Board meetings and investor presentations

### Educational Content
- Lecture slides and course materials
- Student presentations and projects
- Workshop content and tutorials
- Conference presentations

### Creative Showcases
- Portfolio presentations
- Design reviews and critiques
- Creative project demonstrations
- Art and photography galleries

## 🔧 Development & Testing

### Demo Page
Visit `/demo/presentation-deck` to see a full interactive demo with sample slides.

### Testing Features
1. **Navigation**: Test all keyboard shortcuts
2. **Laser Pointer**: Press 'L' and move mouse to test
3. **Thumbnails**: Press 'T' to toggle sidebar
4. **Fullscreen**: Press 'F' for immersive mode
5. **Speaker Notes**: Press 'S' to view notes
6. **Bookmarking**: Press 'B' to bookmark slides

### Performance Considerations
- Images are lazy-loaded for better performance
- State is persisted using Tambo state management
- Smooth animations with CSS transitions
- Optimized re-renders with React.memo patterns

## 🛠️ Troubleshooting

### Common Issues

**Slides not displaying:**
- Check that `slides` array is properly formatted
- Ensure image URLs are accessible
- Verify content HTML is valid

**Keyboard shortcuts not working:**
- Ensure component has focus
- Check that `userPreferences.keyboardShortcuts` is true
- Verify no other components are capturing events

**Fullscreen not working:**
- Modern browsers require user interaction for fullscreen
- Check browser permissions
- Ensure HTTPS context for some browsers

### Debug Mode
Enable debug logging by setting:
```typescript
// In development environment
const debugMode = process.env.NODE_ENV === 'development';
```

## 📱 Browser Support

- **Chrome/Edge**: Full support including fullscreen API
- **Firefox**: Full support with minor styling differences
- **Safari**: Full support, some fullscreen limitations on iOS
- **Mobile**: Responsive design, touch-friendly controls

## 🚀 Future Enhancements

Planned features for future releases:
- PDF import and conversion
- Google Slides API integration
- Voice navigation commands
- Collaborative presentation mode
- Advanced animation transitions
- Multi-screen presenter mode
- Recording and export capabilities

## 📄 License

Part of the Tambo component ecosystem. See project license for details.

---

**Built with ❤️ for the Tambo ecosystem** - Stay present, let the canvas do the rest. 🧘✨ 