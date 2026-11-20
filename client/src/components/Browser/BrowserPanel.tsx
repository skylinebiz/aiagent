import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, ExternalLink, RotateCw, Plus, ArrowLeft, Keyboard, X } from 'lucide-react';

type BrowserTab = { index: number; url: string; title: string; active: boolean };
type BrowserState = { url: string; title: string; tabs: BrowserTab[] };

const api = '/api/browser';

export default function BrowserPanel({ onClose }: { onClose?: () => void }) {
  const [state, setState] = useState<BrowserState>({ url: '', title: 'Shared Browser', tabs: [] });
  const [url, setUrl] = useState('');
  const [typedText, setTypedText] = useState('');
  const [error, setError] = useState('');
  const imageRef = useRef<HTMLImageElement>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${api}/state`, { credentials: 'include' });
      if (!response.ok) return;
      setState(await response.json());
      setError('');
    } catch { setError('Browser is unavailable.'); }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(refresh, 1500);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const action = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch(`${api}/input`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setError(result.error || 'Browser action failed.');
      return;
    }
    setError('');
    await refresh();
  }, [refresh]);

  const navigate = async (event: React.FormEvent) => {
    event.preventDefault();
    const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    await action({ action: 'navigate', url: target });
    setUrl('');
  };

  const clickImage = (event: React.MouseEvent<HTMLImageElement>) => {
    const image = imageRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) return;
    const rect = image.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) * image.naturalWidth / rect.width);
    const y = Math.round((event.clientY - rect.top) * image.naturalHeight / rect.height);
    void action({ action: 'click', x, y });
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface-primary" aria-label="Shared browser">
      <div className="flex items-center gap-2 border-b border-border-light p-3">
        <Globe className="size-4 shrink-0" />
        <form onSubmit={navigate} className="flex min-w-0 flex-1 gap-2">
          <input value={url || state.url} onChange={(event) => setUrl(event.target.value)} aria-label="Browser address" placeholder="Enter website address" className="min-w-0 flex-1 rounded-md border border-border-medium bg-surface-secondary px-3 py-1.5 text-sm" />
          <button type="submit" aria-label="Go to address" className="rounded-md border border-border-medium px-2"><ExternalLink className="size-4" /></button>
        </form>
        <button type="button" onClick={() => void action({ action: 'back' })} aria-label="Go back" className="rounded-md p-2 hover:bg-surface-hover"><ArrowLeft className="size-4" /></button>
        <button type="button" onClick={() => void action({ action: 'reload' })} aria-label="Reload page" className="rounded-md p-2 hover:bg-surface-hover"><RotateCw className="size-4" /></button>
        <button type="button" onClick={() => void action({ action: 'new-tab' })} aria-label="New browser tab" className="rounded-md p-2 hover:bg-surface-hover"><Plus className="size-4" /></button>
        {onClose && <button type="button" onClick={onClose} aria-label="Close browser panel" className="rounded-md p-2 hover:bg-surface-hover"><X className="size-4" /></button>}
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-border-light px-2 py-1">
        {state.tabs.map((tab) => <button type="button" key={tab.index} onClick={() => void action({ action: 'switch', index: tab.index })} className={`max-w-48 truncate rounded px-2 py-1 text-xs ${tab.active ? 'bg-surface-active font-semibold' : 'hover:bg-surface-hover'}`} title={tab.title || tab.url}>{tab.title || tab.url || `Tab ${tab.index + 1}`}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white" onWheel={(event) => void action({ action: 'scroll', deltaY: event.deltaY })} onKeyDown={(event) => {
        if (event.target === imageRef.current && event.key !== 'Tab') void action({ action: 'press', key: event.key });
      }}>
        <img ref={imageRef} tabIndex={0} src={`${api}/screenshot?t=${Date.now()}`} alt={`${state.title || 'Browser'} live view`} onClick={clickImage} className="block h-auto min-h-full w-full cursor-crosshair object-contain" />
        {error && <p role="status" className="m-3 rounded bg-red-100 p-2 text-sm text-red-800">{error}</p>}
      </div>
      <form className="flex gap-2 border-t border-border-light p-2" onSubmit={(event) => { event.preventDefault(); void action({ action: 'type', text: typedText }); setTypedText(''); }}>
        <Keyboard className="mt-2 size-4 shrink-0" />
        <input value={typedText} onChange={(event) => setTypedText(event.target.value)} aria-label="Type into browser" placeholder="Click a field, then type here" className="min-w-0 flex-1 rounded-md border border-border-medium bg-surface-secondary px-3 py-1.5 text-sm" />
        <button type="submit" className="rounded-md border border-border-medium px-3 text-sm">Type</button>
      </form>
      <div className="flex items-center justify-between border-t border-border-light px-3 py-1.5 text-xs text-text-secondary">
        <span className="truncate">{state.url || 'Shared persistent browser'}</span>
        <span>{state.tabs.length} tab{state.tabs.length === 1 ? '' : 's'}</span>
      </div>
    </section>
  );
}
