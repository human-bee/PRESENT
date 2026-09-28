import type { TLAsset, TLDocument, TLShape } from '@tldraw/tlschema';
import type { RoomObject, RoomState } from '../../shared/room';
import { recordsToRoom, shapeToObject } from '../../shared/tldraw-adapter';

/** Native records are immutable. Cache their derived view, never another store.
 * Weak keys release deleted shapes; an image also depends on its asset record.
 */
export function createRoomProjection(id: string) {
  const cache = new WeakMap<TLShape, { asset?: TLAsset; object: RoomObject }>();
  let lastShapes: readonly TLShape[] | undefined, lastAssets: readonly TLAsset[] | undefined;
  let lastDocument: TLDocument | undefined, room: RoomState | undefined;
  let assetsById = new Map<TLAsset['id'], TLAsset>();
  return (shapes: readonly TLShape[], assets: readonly TLAsset[], document?: TLDocument): RoomState => {
    if (room && shapes === lastShapes && assets === lastAssets && document === lastDocument) return room;
    if (assets !== lastAssets) assetsById = new Map(assets.map(asset => [asset.id, asset]));
    const objects = shapes.map(shape => {
      const asset = shape.type === 'image' && shape.props.assetId ? assetsById.get(shape.props.assetId) : undefined;
      const previous = cache.get(shape);
      if (previous && previous.asset === asset) return previous.object;
      const object = shapeToObject(shape, asset ? [asset] : []);
      cache.set(shape, { asset, object });
      return object;
    });
    const metadata = room && document === lastDocument ? room : recordsToRoom(id, document ? [document] : []);
    const unchanged = room && metadata.title === room.title && metadata.events === room.events &&
      objects.length === room.objects.length && objects.every((object, i) => object === room!.objects[i]);
    if (!unchanged) room = { ...metadata, objects };
    lastShapes = shapes; lastAssets = assets; lastDocument = document;
    return room!;
  };
}
