import { useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import type { BrickColor, Part } from '../data/library';
import { useStudio } from '../store/studio';
import { printInstructions } from '../instructions/print';
import { stepsOf } from '../instructions/steps';
import { Button } from '@/components/ui/button';

/** Print a step-by-step booklet: the guide's own steps when following one, otherwise steps derived from the build. */
export default function InstructionsButton({ parts, colors }: { parts: Map<string, Part>; colors: Map<number, BrickColor> }) {
  const [progress, setProgress] = useState<string | null>(null);
  const count = useStudio((s) => s.bricks.length);
  const run = async () => {
    const s = useStudio.getState();
    const steps = s.guided ? s.guided.model.steps : stepsOf(s.bricks);
    if (!steps.length) return;
    setProgress('Rendering…');
    try {
      await printInstructions(s.guided?.model.name ?? s.name, steps, parts, colors, (d, t) => setProgress(`Step ${d} of ${t}…`));
    } catch (e) {
      s.notify((e as Error).message);
    } finally {
      setProgress(null);
    }
  };
  return (
    <Button variant="outline" onClick={run} disabled={!count || !!progress}>
      {progress ? <><Loader2 className="animate-spin" /> {progress}</> : <><BookOpen /> Print instructions</>}
    </Button>
  );
}
