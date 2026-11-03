/* Esportazione ZIP foto per Valmaura: "Civico NN / Int. NN / foto" + Riepilogo.xlsx
   Si aggancia a valmauraApp() senza modificarlo. Va caricato DOPO lo script principale. */
(function () {
    const KEY_ESPORTATE = 'valmaura_foto_esportate';
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    const pulisci = s => String(s).replace(/[\\/:*?"<>|]/g, '-').trim();
    const stampa = ms => {
        const d = new Date(ms);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    };
    const caricaJSZip = () => window.JSZip ? Promise.resolve() : new Promise((ok, ko) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
        s.onload = ok;
        s.onerror = () => ko(new Error('Libreria ZIP non raggiungibile: serve connessione'));
        document.head.appendChild(s);
    });

    const extra = {
        zipInCorso: false,
        zipMsg: '',

        async esportaZip(soloNuove) {
            if (this.zipInCorso) return;
            this.zipInCorso = true;
            this.zipMsg = 'Preparazione...';
            try {
                await caricaJSZip();
                const lista = this.alloggiFiltrati.slice();            // rispetta i filtri attivi
                const chiavi = new Set(lista.map(a => this.chiaveAlloggio(a)));

                // porta sul dispositivo le foto scattate da altri dispositivi (es. dal telefono)
                this.zipMsg = 'Scarico le foto dal cloud...';
                try {
                    await SyncFoto.inviaInSospeso();
                    const cloud = await SyncFoto.elencoCloud();
                    for (const k of Object.keys(cloud)) if (chiavi.has(k)) await SyncFoto.allineaAlloggio(k);
                } catch (e) { /* offline: si usano le foto presenti sul dispositivo */ }

                const esportate = new Set(JSON.parse(localStorage.getItem(KEY_ESPORTATE) || '[]'));
                const perChiave = {};
                (await FotoDB.tutte()).forEach(r => {
                    if (r.stato === 'da_eliminare' || !chiavi.has(r.alloggioKey)) return;
                    (perChiave[r.alloggioKey] ||= []).push(r);
                });

                const zip = new JSZip();
                const incluse = [];
                const righe = [['Civico', 'Interno', 'Inquilino', 'Ditta', 'Fase', 'Stato lavori', 'Esito collaudo',
                                'Data sopralluogo', 'Note cantiere', 'Note verifica', 'Foto totali', 'Foto nello ZIP']];

                for (const a of lista) {
                    const foto = (perChiave[this.chiaveAlloggio(a)] || []).sort((x, y) => x.data - y.data);
                    const cartella = `Civico ${pulisci(a.civico)}/Int. ${pad(pulisci(a.interno))}/`;
                    let nelloZip = 0;
                    foto.forEach((r, i) => {
                        if (soloNuove && esportate.has(r.uid)) return;
                        const tipo = String(r.uid || '').startsWith('scheda-') ? 'SCHEDA_' : '';
                        zip.file(cartella + `${pulisci(a.civico)}_int${pad(pulisci(a.interno))}_${tipo}${stampa(r.data)}_${pad(i + 1)}.jpg`,
                                 r.blob, { compression: 'STORE' });
                        incluse.push(r.uid);
                        nelloZip++;
                    });
                    const c = a.collaudo || {};
                    righe.push([a.civico, a.interno, a.nominativo, a.impresa, a.fase, a.stato, c.esito || '',
                                c.data || '', a.note || '', c.noteVerifica || '', foto.length, nelloZip]);
                }

                if (incluse.length === 0 && soloNuove) { this.zipMsg = 'Nessuna foto nuova da esportare.'; return; }

                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(righe), 'Riepilogo');
                zip.file('Riepilogo.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));

                const blob = await zip.generateAsync({ type: 'blob' }, m => { this.zipMsg = 'Creo lo ZIP... ' + Math.round(m.percent) + '%'; });
                const nome = `Valmaura_${soloNuove ? 'nuove_' : ''}${stampa(Date.now()).slice(0, 10)}.zip`;
                const file = new File([blob], nome, { type: 'application/zip' });

                let fatto = false;
                // su telefono: menu di condivisione (OneDrive, email, ecc.)
                if (matchMedia('(pointer:coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try { await navigator.share({ files: [file], title: nome }); fatto = true; }
                    catch (e) { if (e.name === 'AbortError') { this.zipMsg = 'Condivisione annullata.'; return; } }
                }
                if (!fatto) {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url; link.download = nome;
                    document.body.appendChild(link); link.click(); link.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                }
                localStorage.setItem(KEY_ESPORTATE, JSON.stringify([...new Set([...esportate, ...incluse])]));
                this.zipMsg = `✔ ${incluse.length} foto esportate in ${nome}`;
            } catch (e) {
                this.zipMsg = 'Errore: ' + (e && e.message ? e.message : e);
            } finally {
                this.zipInCorso = false;
            }
        },

        azzeraEsportate() {
            if (!confirm('Le prossime esportazioni "nuove" includeranno di nuovo tutte le foto. Continuare?')) return;
            localStorage.removeItem(KEY_ESPORTATE);
            this.zipMsg = 'Elenco foto già esportate azzerato.';
        }
    };

    // Aggancia i metodi all'app esistente (i getter originali restano intatti)
    const originale = window.valmauraApp;
    window.valmauraApp = function () { return Object.assign(originale(), extra); };

    // Aggiunge i pulsanti accanto a "Esporta Backup JSON"
    const btnJson = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Esporta Backup JSON'));
    if (btnJson) {
        const stile = 'px-4 py-2.5 text-white text-xs font-bold rounded-xl shadow-sm transition-all disabled:opacity-50';
        btnJson.insertAdjacentHTML('beforebegin', `
            <button @click="esportaZip(true)" :disabled="zipInCorso" class="${stile} bg-emerald-600 hover:bg-emerald-500">📦 ZIP foto nuove</button>
            <button @click="esportaZip(false)" :disabled="zipInCorso" class="${stile} bg-slate-700 hover:bg-slate-600">📦 ZIP completo</button>`);
        btnJson.parentElement.insertAdjacentHTML('afterend', `
            <div x-show="zipMsg" class="w-full text-xs font-semibold text-slate-600">
                <span x-text="zipMsg"></span>
                <button @click="azzeraEsportate()" class="ml-2 underline text-slate-400">azzera "già esportate"</button>
            </div>`);
    }
})();
