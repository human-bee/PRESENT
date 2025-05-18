import { cn } from "@/lib/utils";
import { useTamboComponentState } from "@tambo-ai/react";
import { z } from "zod";

export const timelineSchema = z.object({
  title: z.string().optional().describe("Title of the timeline"),
  events: z
    .array(
      z.object({
        id: z.string().describe("Unique identifier for the event"),
        title: z.string().describe("Title of the event"),
        description: z.string().optional().describe("Description of the event"),
        date: z.string().describe("Date or time of the event"),
        icon: z
          .string()
          .optional()
          .describe("Optional icon name from Lucide icons"),
        status: z
          .enum(["completed", "current", "upcoming"])
          .optional()
          .default("upcoming")
          .describe("Status of the timeline event"),
      })
    )
    .describe("Array of timeline events to display"),
  orientation: z
    .enum(["vertical", "horizontal"])
    .optional()
    .default("vertical")
    .describe("Orientation of the timeline"),
});

export type TimelineProps = z.infer<typeof timelineSchema>;

type TimelineState = {
  expandedEvents: string[];
};

export function Timeline({
  title,
  events,
  orientation = "vertical",
}: TimelineProps) {
  const [state, setState] = useTamboComponentState<TimelineState>("timeline", {
    expandedEvents: [],
  });

  const toggleEvent = (eventId: string) => {
    if (!state) return;

    const expandedEvents = [...state.expandedEvents];
    const index = expandedEvents.indexOf(eventId);

    if (index > -1) {
      expandedEvents.splice(index, 1);
    } else {
      expandedEvents.push(eventId);
    }

    setState({ expandedEvents });
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      {title && <h3 className="text-xl font-semibold mb-4">{title}</h3>}

      <div
        className={cn(
          "relative",
          orientation === "vertical" ? "space-y-6 pl-6" : "flex space-x-6"
        )}
      >
        {/* Line connecting timeline events */}
        {orientation === "vertical" && (
          <div className="absolute left-0 top-0 h-full w-0.5 bg-gray-200 dark:bg-gray-700" />
        )}
        {orientation === "horizontal" && (
          <div className="absolute left-0 top-1/2 w-full h-0.5 bg-gray-200 dark:bg-gray-700" />
        )}

        {events?.map((event) => {
          const isExpanded = state?.expandedEvents.includes(event.id);

          return (
            <div
              key={event.id}
              className={cn(
                "relative",
                orientation === "horizontal" ? "flex-1" : ""
              )}
            >
              {/* Timeline node */}
              <div
                className={cn(
                  "absolute w-3 h-3 rounded-full left-[-24px]",
                  orientation === "horizontal"
                    ? "left-1/2 -translate-x-1/2 top-[-16px]"
                    : "",
                  event.status === "completed"
                    ? "bg-green-500"
                    : event.status === "current"
                    ? "bg-blue-500"
                    : "bg-gray-400"
                )}
              />

              <div
                className={cn(
                  "p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm",
                  "hover:shadow-md transition-shadow cursor-pointer"
                )}
                onClick={() => toggleEvent(event.id)}
              >
                <div className="flex justify-between items-start">
                  <h4 className="font-medium text-gray-900 dark:text-gray-100">
                    {event.title}
                  </h4>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {event.date}
                  </span>
                </div>

                {(isExpanded || !event.description) && event.description && (
                  <p className="mt-2 text-gray-600 dark:text-gray-300 text-sm">
                    {event.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
