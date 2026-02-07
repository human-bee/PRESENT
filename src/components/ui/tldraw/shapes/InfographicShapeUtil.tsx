
import {
    BaseBoxShapeUtil,
    Geometry2d,
    HTMLContainer,
    Rectangle2d,
    TLBaseShape,
    getDefaultColorTheme,
    T,
    type RecordProps,
} from '@tldraw/tldraw'
import { InfographicWidget } from '@/components/InfographicWidget'
import { useRoomContext } from '@livekit/components-react'

export type InfographicShape = TLBaseShape<
    'infographic',
    {
        w: number
        h: number
    }
>

export class InfographicShapeUtil extends BaseBoxShapeUtil<InfographicShape> {
    static override type = 'infographic' as const
    static override props = {
        w: T.number,
        h: T.number,
    } as unknown as RecordProps<InfographicShape>

    override getDefaultProps(): InfographicShape['props'] {
        return {
            w: 400,
            h: 600,
        }
    }

    override getGeometry(shape: InfographicShape): Geometry2d {
        return new Rectangle2d({
            width: shape.props.w,
            height: shape.props.h,
            isFilled: true,
        })
    }

    override component(shape: InfographicShape) {
        return (
            <HTMLContainer style={{ pointerEvents: 'all' }}>
                <InfographicShapeComponent shapeId={shape.id} />
            </HTMLContainer>
        )
    }
    override indicator(shape: InfographicShape) {
        return <rect width={shape.props.w} height={shape.props.h} />
    }
}

function InfographicShapeComponent({ shapeId }: { shapeId: string }) {
    const room = useRoomContext()

    return (
        <div
            className="w-full h-full overflow-hidden bg-zinc-950 rounded-2xl shadow-xl border border-white/10"
            onPointerDown={(e) => {
                const target = e.target as HTMLElement;
                if (
                    target.closest('button') ||
                    target.closest('input') ||
                    target.closest('select') ||
                    target.closest('textarea') ||
                    target.closest('[draggable="true"]')
                ) {
                    e.stopPropagation();
                }
            }}
        >
            <InfographicWidget room={room} isShape={true} messageId={shapeId} contextKey="canvas" />
        </div>
    )
}
