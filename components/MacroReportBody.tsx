import React from 'react';
import { parseMacroReportLines } from '../utils/formatMacroReportDisplay';

const MacroReportBody: React.FC<{ text: string }> = ({ text }) => {
  const lines = parseMacroReportLines(text);

  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (line.kind === 'blank') {
          return <div key={i} className="h-2" aria-hidden />;
        }
        if (line.kind === 'heading') {
          return (
            <p
              key={i}
              className="text-sm font-bold text-blue-950 mt-4 mb-1.5 first:mt-0 tracking-tight"
            >
              {line.text}
            </p>
          );
        }
        return (
          <p key={i} className="text-sm text-slate-800 leading-relaxed font-medium pl-0">
            {line.text}
          </p>
        );
      })}
    </div>
  );
};

export default MacroReportBody;
