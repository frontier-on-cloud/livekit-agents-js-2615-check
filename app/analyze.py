"""Summarise one or more run logs (runs/<label>.jsonl) written by run.mjs.

All times are in ms relative to the first `toolCall` server event of the run.
"""
import json
import sys

WINDOW_MS = 500  # "right after the toolCall": well before the 3 s tool resolves


def load(path):
    return [json.loads(line) for line in open(path) if line.strip()]


def server_event(d):
    if d.get('msg') == 'received Gemini Live server event':
        return d.get('lk.pii.response') or {}
    return None


def summarise(path):
    rows = load(path)
    label = next((d.get('label') for d in rows if d.get('event') == 'run_start'), path)
    t_call = None
    call_id = None
    for d in rows:
        se = server_event(d)
        if se and se.get('toolCall'):
            t_call = d['time']
            call_id = se['toolCall']['functionCalls'][0].get('id')
            break
    out = {'run': label, 'connects': max((d.get('n', 0) for d in rows if d.get('event') == 'genai_live_connect'), default=0)}
    if t_call is None:
        out['tool_call'] = False
        return out
    out['tool_call'] = True

    def rel(d):
        return d['time'] - t_call

    after = [d for d in rows if d['time'] >= t_call]
    # skip the toolCall line itself and anything logged before it in the same ms
    idx = next(i for i, d in enumerate(rows) if (server_event(d) or {}).get('toolCall'))
    after = rows[idx + 1:]

    # server events after the call, before the tool response
    gc = tc = None
    content_between = False
    for d in after:
        se = server_event(d)
        if se is None:
            continue
        sc = se.get('serverContent') or {}
        if sc.get('modelTurn') or sc.get('outputTranscription') or sc.get('inputTranscription'):
            if gc is None:
                content_between = True
        if gc is None and sc.get('generationComplete'):
            gc = rel(d)
        if tc is None and sc.get('turnComplete'):
            tc = rel(d)
        if gc is not None and tc is not None:
            break
    out['generationComplete_after_call_ms'] = gc
    out['turnComplete_after_call_ms'] = tc
    out['content_before_generationComplete'] = content_between

    win = [d for d in after if rel(d) <= WINDOW_MS]
    out['new_generation_after_call_ms'] = [rel(d) for d in win if str(d.get('msg', '')).startswith('new generation started')]
    out['input_speech_started_after_call_ms'] = [rel(d) for d in win if d.get('msg') == 'onInputSpeechStarted']
    out['user_activity_start_in_window'] = any(
        ((server_event(d) or {}).get('voiceActivity') or {}).get('type') == 'ACTIVITY_START' for d in win
    )
    out['speech_created_in_window'] = [
        {'t': rel(d), 'id': d['speechId'], 'source': d['source'], 'userInitiated': d['userInitiated']}
        for d in win if d.get('event') == 'speech_created'
    ]

    owner = next((d.get('speech_id') for d in rows if d.get('msg') == 'Executing LLM tool call'), None)
    out['owner_speech'] = owner
    # The plugin logs "received ..." before taking its session lock, so the generation opened by
    # the inputTranscription that precedes the toolCall can be processed a few ms after the
    # toolCall line. Only what happens after the owner speech exists counts as "after the call".
    i_owner = next((i for i, d in enumerate(rows) if d.get('event') == 'speech_created' and d.get('speechId') == owner), None)
    out['owner_speech_created_ms'] = rel(rows[i_owner]) if i_owner is not None else None
    out['phantom_speech_after_call'] = [s for s in out['speech_created_in_window'] if s['id'] != owner]
    out['input_speech_started_after_owner_ms'] = [
        rel(d) for i, d in enumerate(rows)
        if i_owner is not None and i > max(i_owner, idx) and rel(d) <= WINDOW_MS and d.get('msg') == 'onInputSpeechStarted'
    ]
    abort = [d for d in rows if d.get('msg') == 'Aborting all realtime generation tasks due to interruption'
             and d.get('speech_id') == owner]
    out['owner_aborted_due_to_interruption_ms'] = rel(abort[0]) if abort else None
    done = [d for d in rows if d.get('event') == 'speech_done' and d.get('speechId') == owner]
    out['owner_speech_interrupted'] = done[0]['interrupted'] if done else None

    ts = [d for d in rows if d.get('event') == 'tool_execute_started']
    tf = [d for d in rows if d.get('event') == 'tool_execute_finished']
    fte = [d for d in rows if d.get('event') == 'function_tools_executed']
    tr = [d for d in rows if d.get('event') == 'genai_send_tool_response'
          and any(r.get('id') == call_id for r in d.get('responses', []))]
    out['tool_started_ms'] = rel(ts[0]) if ts else None
    out['tool_finished_ms'] = rel(tf[0]) if tf else None
    out['function_tools_executed_ms'] = rel(fte[0]) if fte else None
    out['function_response_sent_ms'] = rel(tr[0]) if tr else None
    out['tool_response_willContinue'] = [r.get('willContinue') for d in tr for r in d['responses']]

    # what the agent said, and whether it was cut
    out['assistant_items'] = [
        {'t': rel(d), 'text': d.get('text'), 'interrupted': d.get('interrupted')}
        for d in rows if d.get('event') == 'conversation_item_added' and d.get('role') == 'assistant'
    ]
    out['playout'] = [
        {'t': rel(d), 'interrupted': d['interrupted'], 'playedMs': d['playedMs'], 'pushedMs': d['pushedMs']}
        for d in rows if d.get('event') == 'playout_finished'
    ]
    out['errors'] = [d.get('msg') or d.get('error') for d in rows
                     if (d.get('level', 0) >= 50) or d.get('event') in ('session_error', 'hard_timeout', 'abort_extra_connect')]
    return out


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(json.dumps(summarise(p)))
