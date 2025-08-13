# 🎯 Sub-Agent Mission: Fix Custom Shape Sizing & Resizing (PRE-101)

## 🚨 **PRIORITY: FOUNDATIONAL - BLOCKS 4+ OTHER ISSUES**

You are a specialized sub-agent focused on **fixing TLDraw custom shape sizing and resizing issues**. This is a foundational issue that blocks multiple other critical features.

## 📋 **Mission Summary**

Fix the disconnect between TLDraw's native shape system and Tambo's custom components so that:
1. Custom shapes display at their correct/full size
2. Shapes are properly resizable via TLDraw handles
3. Shape perimeter/bounds are synchronized with component content
4. No more independent movement between blue perimeter and custom content

## 🔍 **Current Problem Analysis**

### **Key Files to Focus On:**
- `src/components/ui/tldraw-canvas.tsx` - TamboShapeUtil implementation
- `src/components/ui/canvas-space.tsx` - Component creation with default sizing
- TLDraw's shape system integration

### **Current Implementation Issues:**

1. **Fixed Default Sizing** (`canvas-space.tsx:277`):
   ```typescript
   const defaultShapeProps = { w: 300, h: 200 }; // Hardcoded!
   ```

2. **ResizeObserver Disconnect** (`tldraw-canvas.tsx:70-97`):
   ```typescript
   // ResizeObserver detects changes but doesn't sync back to TLDraw
   // Shape size tracking for potential future use
   // Note: We can't access editor here directly
   ```

3. **Component vs Shape Size Mismatch**:
   - TLDraw shape has `w: 300, h: 200`
   - React component renders at natural size
   - No synchronization mechanism

## 🎯 **Technical Requirements**

### **1. Dynamic Size Detection**
Implement proper size detection for components:
```typescript
interface ComponentSizeInfo {
  naturalWidth: number;
  naturalHeight: number;
  minWidth: number;
  minHeight: number;
  aspectRatio?: number;
  preferredSize?: { width: number; height: number };
}

// Each component should provide this info
const getComponentSizeInfo = (componentName: string): ComponentSizeInfo => {
  // Weather: 350x250, YouTube: 400x300, Timer: 200x150, etc.
};
```

### **2. Bidirectional Size Sync**
Fix the ResizeObserver to properly sync with TLDraw:
```typescript
// Replace current broken ResizeObserver with:
const useTLDrawShapeSync = (shape: TamboShape, editor: Editor) => {
  // Component size changes → update TLDraw shape
  // TLDraw resize → update component container
  // Maintain aspect ratios when needed
};
```

### **3. Enhanced TamboShapeUtil**
Update the shape utility to handle dynamic sizing:
```typescript
export class TamboShapeUtil extends BaseBoxShapeUtil<TamboShape> {
  // Override getInitialMetaForShape to set proper initial size
  // Override onResize to handle component-specific constraints
  // Override getBounds to ensure proper perimeter calculation
}
```

## 🛠️ **Implementation Steps**

### **Phase 1: Size Detection System**
1. Create `src/lib/component-sizing.ts` with size detection utilities
2. Add size metadata to each component in `src/lib/tambo.ts`
3. Test size detection for 3-5 major components

### **Phase 2: TLDraw Integration**
1. Fix ResizeObserver in `TamboShapeComponent` to access editor properly
2. Implement bidirectional sync between component and shape size
3. Update shape creation to use component-specific initial sizes

### **Phase 3: Shape Utility Enhancement**
1. Override TamboShapeUtil methods for proper bounds calculation
2. Implement resize constraints (min/max, aspect ratios)
3. Ensure perimeter and content stay synchronized

### **Phase 4: Testing & Validation**
1. Test with all major components (Weather, YouTube, Timer, etc.)
2. Verify resize handles work smoothly
3. Confirm blue perimeter stays aligned with content

## 🔧 **Code Examples to Implement**

### **Component Size Metadata** (`src/lib/component-sizing.ts`):
```typescript
export const componentSizeInfo: Record<string, ComponentSizeInfo> = {
  WeatherForecast: {
    naturalWidth: 350,
    naturalHeight: 250,
    minWidth: 200,
    minHeight: 150,
    aspectRatio: 1.4
  },
  YouTubeEmbed: {
    naturalWidth: 400,
    naturalHeight: 300,
    minWidth: 320,
    minHeight: 240,
    aspectRatio: 16/9
  },
  RetroTimer: {
    naturalWidth: 200,
    naturalHeight: 150,
    minWidth: 150,
    minHeight: 100
  },
  // ... all components
};
```

### **Enhanced Shape Creation** (`canvas-space.tsx`):
```typescript
// Replace hardcoded defaultShapeProps with:
const getSizeForComponent = (componentName: string) => {
  const sizeInfo = componentSizeInfo[componentName];
  return {
    w: sizeInfo?.naturalWidth || 300,
    h: sizeInfo?.naturalHeight || 200
  };
};

const shapeProps = getSizeForComponent(componentName);
```

### **Fixed ResizeObserver** (`tldraw-canvas.tsx`):
```typescript
function TamboShapeComponent({ shape }: { shape: TamboShape }) {
  const editor = useEditor(); // Access editor properly
  const contentRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!editor || !contentRef.current) return;
    
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      
      // Sync component size back to TLDraw shape
      if (Math.abs(width - shape.props.w) > 2 || 
          Math.abs(height - shape.props.h) > 2) {
        editor.updateShape({
          id: shape.id,
          type: 'tambo',
          props: { ...shape.props, w: width, h: height }
        });
      }
    });
    
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [editor, shape.id]);
  
  // ...rest of component
}
```

## ✅ **Success Criteria**

### **Must Have:**
- [ ] Components appear at their natural/optimal size on creation
- [ ] TLDraw resize handles work smoothly for all custom shapes
- [ ] Blue perimeter perfectly aligns with component content
- [ ] No independent movement between perimeter and content
- [ ] Component content scales properly when shape is resized

### **Quality Checks:**
- [ ] Weather widget: 350x250 default, resizes maintaining readability
- [ ] YouTube player: 16:9 aspect ratio maintained during resize
- [ ] Timer component: compact 200x150, enlarges text when expanded
- [ ] All shapes respond to TLDraw's selection and transformation tools
- [ ] Performance: smooth 60fps resize operations

### **Edge Cases Handled:**
- [ ] Very small resize (minimum size enforcement)
- [ ] Very large resize (maximum size if needed)
- [ ] Rapid resize operations (debouncing/performance)
- [ ] Components with intrinsic aspect ratios
- [ ] Components with no fixed size requirements

## 🚀 **Implementation Priority**

**Start with these components (high usage):**
1. **WeatherForecast** - Most commonly used, clear size requirements
2. **YouTubeEmbed** - Complex with aspect ratio needs  
3. **RetroTimer** - Simple but variable content
4. **ParticipantTile** - Live content sizing

**Then expand to:**
- DocumentEditor, LinearKanbanBoard, Research components
- All remaining components in `tambo.ts`

## 🔗 **Related Issues This Fixes**

- **PRE-100** (Blue Perimeter): Likely resolves as side effect
- **Enables PRE-105** (Agent Board Control): Agents need accurate shape bounds
- **Enables PRE-107** (Supabase Sync): Can't sync broken shapes
- **Enables PRE-110** (Unified Pipeline): Components must render correctly immediately
- **Enables PRE-111** (Progressive Loading): Skeleton → content sizing must work

## 🎯 **Your Mission:**

1. **Analyze** the current codebase sizing issues thoroughly
2. **Implement** the 4-phase solution above
3. **Test** with major components to ensure quality
4. **Document** any edge cases or additional requirements discovered
5. **Report** completion with before/after comparisons

**This is the foundation that enables the entire next-generation Tambo experience! 🚀**

---

*Generated for Linear Issue PRE-101 | Priority: P0 - Foundational*