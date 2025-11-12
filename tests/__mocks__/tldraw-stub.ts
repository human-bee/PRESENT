// Minimal stub for @tldraw/tldraw used in Jest
export const Tldraw = () => null as any;
export const useEditor = () => ({ updateShapes: () => {} }) as any;
export class Editor {}
export class BaseBoxShapeUtil<T> {
  static type: string;
  static props: any;
  getDefaultProps(): any {
    return {};
  }
  component(): any {
    return null;
  }
  indicator(): any {
    return null;
  }
}
export type TLBaseShape<T extends string = string, P = any> = {
  id: string;
  type: T;
  props: P;
};
export type RecordProps<T> = any;
export type TLResizeInfo = any;
export const T = {
  number: {},
  string: {},
  boolean: {},
  optional: (value: any) => value,
};
export const HTMLContainer = ({ children }: any) => children;
export const createShapeId = (id: string) => id;
export const toRichText = (t: any) => t;
export const TLUiOverrides = {} as any;
export const TldrawUiToastsProvider = ({ children }: any) => children;
export const useValue = (fn: any, deps: any[]) => fn();
