"""Apply the isNewGeneration() change from livekit/agents-js#2615 to the installed
@livekit/agents-plugin-google 1.9.1 dist (ESM .js and CJS .cjs). Exact-text replacement;
fails if the original body is not found exactly once."""
import sys
from pathlib import Path

OLD = """    const serverContent = response.serverContent;
    return !!serverContent && (serverContent.modelTurn || serverContent.outputTranscription != null || serverContent.inputTranscription != null || serverContent.generationComplete != null || serverContent.turnComplete != null);
  }"""
NEW = """    const serverContent = response.serverContent;
    if (!serverContent) {
      return false;
    }
    const hasContent = !!serverContent.modelTurn || serverContent.outputTranscription != null || serverContent.inputTranscription != null;
    if (!hasContent && !this.pendingGenerationFut) {
      return false;
    }
    return hasContent || serverContent.generationComplete != null || serverContent.turnComplete != null;
  }"""

base = Path(sys.argv[1]) / 'node_modules/@livekit/agents-plugin-google/dist/realtime'
for name in ('realtime_api.js', 'realtime_api.cjs'):
    p = base / name
    s = p.read_text()
    n = s.count(OLD)
    if n != 1:
        sys.exit(f'{p}: expected 1 match, found {n}')
    p.write_text(s.replace(OLD, NEW))
    print('patched', p)
