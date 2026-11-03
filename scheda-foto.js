/* Foto della scheda di sopralluogo cartacea al posto del caricamento del file Word.
   Le foto della scheda viaggiano come le altre foto (salvate localmente, nello ZIP) ma sono
   riconoscibili dal prefisso "scheda-" nel loro identificativo.
   Va caricato DOPO gli altri script (script principale ed export-zip.js). */
(function () {
    const PREFISSO = 'scheda-';
    const MARCATORE = 'Scheda sopralluogo (foto)';
    const LATO_MAX = 2200;      // più grande delle foto di cantiere: il testo deve restare leggibile
    const QUALITA = 0.85;

    async function comprimiScheda(file) {
        let bmp, w, h;
        try {
            bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
            w = bmp.width; h = bmp.height;
        } catch (e) {
            bmp = await new Promise((ok, ko) => {
                const url = URL.createObjectURL(file), img = new Image();
                img.onload = () => { URL.revokeObjectURL(url); ok(img); };
                img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Immagine non leggibile')); };
                img.src = url;
            });
            w = bmp.naturalWidth; h = bmp.naturalHeight;
        }
        const k = Math.min(1, LATO_MAX / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(bmp, 0, 0, cw, ch);
        if (bmp.close) bmp.close();
        const blob = await new Promise((ok, ko) => canvas.toBlob(b => b ? ok(b) : ko(new Error('Compressione fallita')), 'image/jpeg', QUALITA));
        canvas.width = canvas.height = 0;
        return blob;
    }

    const extra = {
        schedaIds: {},              // id locali (IndexedDB) delle foto che sono schede
        schedaInElaborazione: 0,

        // Segna come "esportata/indicata" la presenza della scheda (serve alla colorazione delle righe)
        aggiornaMarcatoreScheda(chiave, svuota) {
            if (!this.modaleGestioneAperto || this.chiaveAlloggio(this.alloggioCorrente) !== chiave) return;
            const aggiorna = a => {
                if (!a.collaudo) return false;
                const attuale = a.collaudo.fileWord || '';
                if (this.schede.length > 0 && attuale !== MARCATORE) { a.collaudo.fileWord = MARCATORE; return true; }
                // si svuota solo dopo un'eliminazione: all'apertura le schede potrebbero non essere ancora scaricate
                if (svuota && this.schede.length === 0 && attuale === MARCATORE) { a.collaudo.fileWord = ''; return true; }
                return false;
            };
            aggiorna(this.alloggioCorrente);
            const live = this.alloggi.find(a => this.chiaveAlloggio(a) === chiave);
            if (live && aggiorna(live)) this.salvaDati();
        },

        async aggiungiScheda(event) {
            const input = event.target;
            const files = Array.from(input.files || []);
            input.value = '';
            if (!files.length) return;
            this.fotoErrore = '';
            const chiave = this.chiaveAlloggio(this.alloggioCorrente);
            this.schedaInElaborazione += files.length;
            for (const file of files) {
                try {
                    const blob = await comprimiScheda(file);
                    await FotoDB.aggiungi({
                        uid: PREFISSO + nuovoUid(), alloggioKey: chiave, blob,
                        nome: 'scheda_' + chiave + '_' + new Date().toISOString().replace(/[:.]/g, '-') + '.jpg',
                        size: blob.size, data: Date.now(), stato: 'locale'
                    });
                    await this._ricaricaFotoLocali(chiave);
                } catch (e) {
                    this.fotoErrore = 'Errore nel salvataggio della scheda: ' + (e && e.message ? e.message : e);
                } finally {
                    this.schedaInElaborazione--;
                }
            }
            await this._sincronizzaContatoreFoto(chiave);
            this._aggiornaStatoFotoLocale(chiave);
        }
    };

    // getter: vanno copiati come descrittori (Object.assign li valuterebbe subito)
    const getter = {
        schede: { get() { return this.fotoAlloggio.filter(f => this.schedaIds[f.id]); }, enumerable: true, configurable: true },
        fotoCantiere: { get() { return this.fotoAlloggio.filter(f => !this.schedaIds[f.id]); }, enumerable: true, configurable: true }
    };

    const originale = window.valmauraApp;
    window.valmauraApp = function () {
        const o = Object.assign(originale(), extra);
        Object.defineProperties(o, getter);
        const ricarica = o._ricaricaFotoLocali;
        o._ricaricaFotoLocali = async function (chiave) {
            try {   // prima di ridisegnare: così una scheda non compare mai tra le foto di cantiere
                const m = {};
                (await FotoDB.elenca(chiave)).forEach(r => { if (String(r.uid || '').startsWith(PREFISSO)) m[r.id] = true; });
                this.schedaIds = m;
            } catch (e) { /* non bloccante */ }
            await ricarica.call(this, chiave);
            this.aggiornaMarcatoreScheda(chiave, false);
        };
        const elimina = o.eliminaFoto;
        o.eliminaFoto = async function (f) {
            const eraScheda = !!this.schedaIds[f.id];
            const chiave = this.chiaveAlloggio(this.alloggioCorrente);
            await elimina.call(this, f);
            if (eraScheda) this.aggiornaMarcatoreScheda(chiave, true);
        };
        return o;
    };

    // --- Modifiche all'interfaccia ---
    // 1) il blocco "Verbale Word" diventa "Scheda sopralluogo (foto)"
    const h4 = Array.from(document.querySelectorAll('h4')).find(h => h.textContent.includes('Verbale / Scheda Sopralluogo'));
    const blocco = h4 && h4.closest('[class*="space-y-3"]');
    if (blocco) blocco.outerHTML = `
        <div class="bg-blue-50/60 p-4 rounded-2xl border border-blue-200 space-y-3">
            <div class="flex items-center space-x-3">
                <span class="text-3xl">📋</span>
                <div>
                    <h4 class="text-xs font-black text-blue-900 uppercase tracking-wider">Scheda sopralluogo compilata (foto)</h4>
                    <p class="text-xs text-blue-700 mt-0.5" x-text="schede.length ? schede.length + (schede.length === 1 ? ' foto della scheda' : ' foto della scheda') + ' · salvate su questo telefono' : 'Nessuna foto della scheda'"></p>
                    <p class="text-[11px] text-blue-600 mt-0.5">Inquadra il foglio intero, dritto e ben illuminato.</p>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <label class="px-3.5 py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl cursor-pointer shadow-sm transition-all text-center">
                    📸 Fotografa scheda
                    <input type="file" @change="aggiungiScheda($event)" class="hidden" accept="image/*" capture="environment">
                </label>
                <label class="px-3.5 py-3 bg-white hover:bg-blue-100 text-blue-800 border border-blue-300 text-xs font-bold rounded-xl cursor-pointer shadow-sm transition-all text-center">
                    🖼️ Dalla galleria
                    <input type="file" @change="aggiungiScheda($event)" class="hidden" accept="image/*" multiple>
                </label>
            </div>
            <p x-show="fotoErrore" class="text-xs text-red-600 font-semibold" x-text="fotoErrore"></p>
            <p x-show="schedaInElaborazione > 0" class="text-xs text-blue-800 font-semibold" x-text="'Elaborazione di ' + schedaInElaborazione + ' foto...'"></p>
            <div class="grid grid-cols-3 sm:grid-cols-4 gap-2" x-show="schede.length > 0">
                <template x-for="f in schede" :key="f.id">
                    <div class="relative aspect-square rounded-xl overflow-hidden border border-slate-200 bg-white shadow-sm">
                        <img :src="f.url" class="w-full h-full object-cover" @click="fotoAperta = f" alt="Scheda sopralluogo">
                        <button @click.stop="eliminaFoto(f)" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600/90 text-white text-sm font-black leading-none" aria-label="Elimina foto">&times;</button>
                        <span class="absolute bottom-0 inset-x-0 bg-slate-900/60 text-white text-[9px] text-center py-0.5" x-text="'📱 ' + Math.round(f.size / 1024) + ' KB'"></span>
                    </div>
                </template>
            </div>
        </div>`;

    // 2) la griglia "Foto di posa" mostra solo le foto di cantiere
    document.querySelectorAll('template[x-for]').forEach(t => {
        if (t.getAttribute('x-for') === 'f in fotoAlloggio') t.setAttribute('x-for', 'f in fotoCantiere');
    });
    document.querySelectorAll('[x-show]').forEach(el => {
        if (el.getAttribute('x-show') === 'fotoAlloggio.length > 0') el.setAttribute('x-show', 'fotoCantiere.length > 0');
    });
    document.querySelectorAll('[x-text]').forEach(el => {
        const t = el.getAttribute('x-text');
        if (t.startsWith("fotoAlloggio.length + ' foto")) el.setAttribute('x-text', t.replace('fotoAlloggio.length', 'fotoCantiere.length'));
    });

    // 3) legenda
    document.querySelectorAll('span').forEach(s => {
        if (s.children.length === 0 && s.textContent.includes('Word + Foto caricate')) s.textContent = s.textContent.replace('Word + Foto caricate', 'Scheda + Foto caricate');
    });
})();
