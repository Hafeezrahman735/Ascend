import { createLiveActivity } from 'expo-widgets';
import { HStack, Image, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { foregroundColor, frame, lineLimit, padding } from '@expo/ui/swift-ui/modifiers';

import type { TimerActivityProps } from '../lib/liveActivityState';

/**
 * The Focus timer's Lock Screen card and Dynamic Island presentations.
 *
 * Read this before editing:
 *
 * The `'widget'` directive makes Babel serialise this function to a *string* at
 * build time. It is then evaluated in a separate JavaScript context inside the
 * widget extension, where the SwiftUI components and `React` are injected as
 * globals. The imports above exist for types and for the app bundle — they are
 * NOT in scope at render time.
 *
 * The practical consequences, which are easy to trip over:
 *   - This function may close over NOTHING. No module constants, no helper
 *     functions, no theme tokens. Everything it needs arrives in `props`, which
 *     is why formatting is inlined below rather than shared with the app.
 *   - Dates cannot be passed in. Props go through `JSON.stringify`, so the
 *     adapter sends epoch milliseconds and we rebuild `Date` here.
 *
 * The countdown is `Text(timerInterval:pauseTime:countsDown:)` — Apple's own
 * mechanism. iOS rasterises the ticking from a date range with zero ongoing work
 * from the app or the widget process. There is deliberately no timer, no
 * TimelineView and no repeated update() call anywhere in this feature.
 */
const AscendTimerActivity = createLiveActivity<TimerActivityProps>(
  'AscendTimer',
  (props) => {
    'widget';

    const interval = {
      lower: new Date(props.rangeStartMs),
      upper: new Date(props.rangeEndMs),
    };
    const pauseTime = props.pausedAtMs == null ? undefined : new Date(props.pausedAtMs);

    // Deep Focus Midnight's accent. Live Activities cannot read the app's theme
    // tokens — the widget bundle has no access to app modules — so the accent is
    // duplicated here as a literal. The Lock Screen also composites over an
    // unknown wallpaper, so everything else stays on system colors, which adapt
    // to light/dark and to the tinted rendering modes on their own.
    const accent = props.phaseLabel === 'Focus' ? '#7B6EF6' : '#3FBF8F';

    const countdown = (
      <Text
        timerInterval={interval}
        countsDown={props.countsDown}
        pauseTime={pauseTime}
        modifiers={[foregroundColor(accent)]}
      />
    );

    return {
      banner: (
        <VStack spacing={6} modifiers={[padding({ all: 16 })]}>
          <HStack spacing={8}>
            <Image systemName={props.isPaused ? 'pause.circle.fill' : 'timer'} />
            <Text>{props.isPaused ? `${props.phaseLabel} · Paused` : props.phaseLabel}</Text>
            <Spacer />
            {countdown}
          </HStack>

          {props.taskLabel ? <Text modifiers={[lineLimit(1)]}>{props.taskLabel}</Text> : null}

          {/* ProgressView has timerInterval but no pauseTime, so a paused card
              would keep draining its bar while the text stood still. Paused
              hands it a fixed value instead and the two agree. The stopwatch has
              no end to measure against, so it gets no bar at all. */}
          {props.countsDown ? (
            props.isPaused ? (
              <ProgressView value={props.pausedProgress ?? 0} />
            ) : (
              <ProgressView timerInterval={interval} countsDown />
            )
          ) : null}
        </VStack>
      ),

      compactLeading: (
        <Image systemName={props.isPaused ? 'pause.fill' : 'timer'} />
      ),
      compactTrailing: (
        <Text
          timerInterval={interval}
          countsDown={props.countsDown}
          pauseTime={pauseTime}
          modifiers={[frame({ maxWidth: 46 }), foregroundColor(accent)]}
        />
      ),
      minimal: (
        <Text
          timerInterval={interval}
          countsDown={props.countsDown}
          pauseTime={pauseTime}
          modifiers={[frame({ maxWidth: 42 }), foregroundColor(accent)]}
        />
      ),

      expandedLeading: (
        <Text modifiers={[padding({ leading: 4 })]}>
          {props.isPaused ? `${props.phaseLabel} · Paused` : props.phaseLabel}
        </Text>
      ),
      expandedTrailing: (
        <Text modifiers={[padding({ trailing: 4 }), foregroundColor(accent)]}
          timerInterval={interval}
          countsDown={props.countsDown}
          pauseTime={pauseTime}
        />
      ),
      expandedBottom: (
        <VStack spacing={6} modifiers={[padding({ horizontal: 4 })]}>
          {props.taskLabel ? <Text modifiers={[lineLimit(1)]}>{props.taskLabel}</Text> : null}
          {props.countsDown ? (
            props.isPaused ? (
              <ProgressView value={props.pausedProgress ?? 0} />
            ) : (
              <ProgressView timerInterval={interval} countsDown />
            )
          ) : null}
        </VStack>
      ),
    };
  },
);

export default AscendTimerActivity;
