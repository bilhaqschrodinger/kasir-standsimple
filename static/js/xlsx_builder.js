// kasir-standsimple — Generator File Excel (.xlsx) Murni di Browser (Zero-Dependency, Offline-Ready)
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.StandXlsx = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const encoder = new TextEncoder();

  // CRC-32 table untuk PKZIP
  const CRC_TABLE = (() => {
    const tbl = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      tbl[n] = c >>> 0;
    }
    return tbl;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function sanitizeExcelText(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (!text || text === '-') return text;
    const stripped = text.trimStart();
    if (
      (stripped && ['=', '+', '-', '@'].includes(stripped[0])) ||
      ['\t', '\r', '\n'].includes(text[0])
    ) {
      return `'${text}`;
    }
    return text;
  }

  function escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function colLetter(colIdx1) {
    let n = colIdx1;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function buildCellXml(rowIdx, colIdx, value, styleIdx) {
    const ref = `${colLetter(colIdx)}${rowIdx}`;
    const sAttr = styleIdx ? ` s="${styleIdx}"` : '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<c r="${ref}"${sAttr}><v>${value}</v></c>`;
    }
    const text = value === null || value === undefined ? '' : String(value);
    if (text === '') {
      return `<c r="${ref}"${sAttr}/>`;
    }
    return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  }

  function buildWorksheetXml(rows, colWidths, freezeTopRow) {
    const colsXml = colWidths
      .map(
        (w, idx) =>
          `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`
      )
      .join('');

    const sheetViewsXml = freezeTopRow
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';

    const rowsXml = rows
      .map((r) => {
        const htAttr = r.height ? ` ht="${r.height}" customHeight="1"` : '';
        const cellsXml = r.cells
          .map((c) => buildCellXml(r.rowIdx, c.col, c.value, c.style))
          .join('');
        return `<row r="${r.rowIdx}"${htAttr}>${cellsXml}</row>`;
      })
      .join('');

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      sheetViewsXml +
      `<cols>${colsXml}</cols>` +
      `<sheetData>${rowsXml}</sheetData>` +
      '</worksheet>'
    );
  }

  function buildStylesXml() {
    // numFmtId: 164 = integer #,##0 ; 165 = currency "Rp "#,##0 ; 166 = percent 0.0%
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="3">' +
      '<numFmt numFmtId="164" formatCode="#,##0"/>' +
      '<numFmt numFmtId="165" formatCode="&quot;Rp &quot;#,##0;-&quot;Rp &quot;#,##0;&quot;Rp &quot;0"/>' +
      '<numFmt numFmtId="166" formatCode="0.0%"/>' +
      '</numFmts>' +
      '<fonts count="8">' +
      '<font><sz val="10"/><color rgb="FF18181B"/><name val="Calibri"/></font>' + // 0: body
      '<font><b/><sz val="14"/><color rgb="FF18181B"/><name val="Calibri"/></font>' + // 1: title
      '<font><b/><sz val="11"/><color rgb="FF18181B"/><name val="Calibri"/></font>' + // 2: section
      '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' + // 3: header white
      '<font><b/><sz val="10"/><color rgb="FF18181B"/><name val="Calibri"/></font>' + // 4: bold
      '<font><b/><sz val="10"/><color rgb="FF15803D"/><name val="Calibri"/></font>' + // 5: profit pos
      '<font><b/><sz val="10"/><color rgb="FFB91C1C"/><name val="Calibri"/></font>' + // 6: profit neg
      '<font><strike/><sz val="10"/><color rgb="FFB91C1C"/><name val="Calibri"/></font>' + // 7: void
      '</fonts>' +
      '<fills count="5">' +
      '<fill><patternFill patternType="none"/></fill>' + // 0
      '<fill><patternFill patternType="gray125"/></fill>' + // 1
      '<fill><patternFill patternType="solid"><fgColor rgb="FF18181B"/></patternFill></fill>' + // 2: header
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF4F4F5"/></patternFill></fill>' + // 3: total/section
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFEF2F2"/></patternFill></fill>' + // 4: void
      '</fills>' +
      '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border>' +
      '<left style="thin"><color rgb="FFD4D4D8"/></left>' +
      '<right style="thin"><color rgb="FFD4D4D8"/></right>' +
      '<top style="thin"><color rgb="FFD4D4D8"/></top>' +
      '<bottom style="thin"><color rgb="FFD4D4D8"/></bottom>' +
      '<diagonal/>' +
      '</border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="21">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="center"/></xf>' + // 0: plain
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>' + // 1: title
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>' + // 2: section
      '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' + // 3: hdr left
      '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 4: hdr center
      '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + // 5: hdr right
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' + // 6: body left
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 7: body center
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + // 8: body int
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + // 9: body currency
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + // 10: body pct
      '<xf numFmtId="0" fontId="4" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' + // 11: total left
      '<xf numFmtId="164" fontId="4" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + // 12: total int
      '<xf numFmtId="165" fontId="4" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + // 13: total currency
      '<xf numFmtId="166" fontId="4" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + // 14: total pct
      '<xf numFmtId="165" fontId="5" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + // 15: profit pos
      '<xf numFmtId="165" fontId="6" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + // 16: profit neg
      '<xf numFmtId="0" fontId="7" fillId="4" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' + // 17: void left
      '<xf numFmtId="0" fontId="7" fillId="4" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 18: void center
      '<xf numFmtId="164" fontId="7" fillId="4" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + // 19: void int
      '<xf numFmtId="165" fontId="7" fillId="4" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' + // 20: void currency
      '</cellXfs>' +
      '</styleSheet>'
    );
  }

  function buildRingkasanSheet(data) {
    const rows = [];
    rows.push({
      rowIdx: 1,
      height: 26,
      cells: [{ col: 1, value: 'Laporan Penjualan Harian — kasir-standsimple', style: 1 }],
    });
    rows.push({
      rowIdx: 2,
      cells: [
        { col: 1, value: 'Tanggal Laporan', style: 0 },
        { col: 2, value: `${data.tanggal} (WIB)`, style: 0 },
      ],
    });
    rows.push({
      rowIdx: 3,
      cells: [
        { col: 1, value: 'Waktu Export', style: 0 },
        { col: 2, value: `${String(data.exported_at || '').replace('T', ' ')} WIB`, style: 0 },
      ],
    });
    rows.push({
      rowIdx: 5,
      height: 22,
      cells: [{ col: 1, value: 'Ringkasan Keuangan & Transaksi', style: 2 }],
    });
    rows.push({
      rowIdx: 6,
      height: 24,
      cells: [
        { col: 1, value: 'Metrik', style: 3 },
        { col: 2, value: 'Nilai', style: 5 },
      ],
    });

    const summary = [
      ['Transaksi Berhasil (PAID)', data.jumlah_paid, 8],
      ['Transaksi Dibatalkan (VOID)', data.jumlah_void, 8],
      ['Total Item / Cup Terjual', data.total_item_terjual, 8],
      ['Total Omzet Kotor', data.total_pendapatan, 13],
      ['Penerimaan Cash', data.total_cash, 9],
      ['Penerimaan QRIS', data.total_qris, 9],
      ['Penerimaan Transfer (TF)', data.total_tf, 9],
      ['Rata-rata per Transaksi', data.rata_rata_trx, 9],
      ['Modal Harian', data.modal_awal, 9],
      ['Laba Bersih (Omzet - Modal)', data.laba_bersih, data.laba_bersih >= 0 ? 15 : 16],
    ];

    let r = 7;
    for (const [label, val, valStyle] of summary) {
      const isTotal = label.startsWith('Total Omzet') || label.startsWith('Laba Bersih');
      rows.push({
        rowIdx: r,
        height: 20,
        cells: [
          { col: 1, value: label, style: isTotal ? 11 : 6 },
          { col: 2, value: val, style: valStyle },
        ],
      });
      r += 1;
    }

    const secRow = r + 1;
    rows.push({
      rowIdx: secRow,
      height: 22,
      cells: [{ col: 1, value: 'Rekap Penjualan per Menu / Item', style: 2 }],
    });

    const hdrRow = secRow + 1;
    rows.push({
      rowIdx: hdrRow,
      height: 24,
      cells: [
        { col: 1, value: 'No', style: 4 },
        { col: 2, value: 'Nama Menu / Item', style: 3 },
        { col: 3, value: 'Terjual (Qty)', style: 5 },
        { col: 4, value: 'Total Penjualan', style: 5 },
        { col: 5, value: 'Porsi Omzet', style: 5 },
      ],
    });

    let itemRow = hdrRow + 1;
    const items = data.item_breakdown || [];
    if (items.length === 0) {
      rows.push({
        rowIdx: itemRow,
        height: 22,
        cells: [
          { col: 1, value: '-', style: 7 },
          { col: 2, value: 'Belum ada item terjual (PAID) pada tanggal ini.', style: 6 },
          { col: 3, value: 0, style: 8 },
          { col: 4, value: 0, style: 9 },
          { col: 5, value: 0, style: 10 },
        ],
      });
      itemRow += 1;
    } else {
      items.forEach((it, idx) => {
        const share = data.total_pendapatan > 0 ? it.total / data.total_pendapatan : 0;
        rows.push({
          rowIdx: itemRow,
          height: 20,
          cells: [
            { col: 1, value: idx + 1, style: 7 },
            { col: 2, value: sanitizeExcelText(it.nama_item), style: 6 },
            { col: 3, value: it.qty, style: 8 },
            { col: 4, value: it.total, style: 9 },
            { col: 5, value: share, style: 10 },
          ],
        });
        itemRow += 1;
      });
    }

    rows.push({
      rowIdx: itemRow,
      height: 22,
      cells: [
        { col: 1, value: 'Total', style: 11 },
        { col: 2, value: '', style: 11 },
        { col: 3, value: data.total_item_terjual, style: 12 },
        { col: 4, value: data.total_pendapatan, style: 13 },
        { col: 5, value: data.total_pendapatan > 0 && items.length > 0 ? 1 : 0, style: 14 },
      ],
    });

    return buildWorksheetXml(rows, [32, 28, 16, 20, 14], false);
  }

  function buildTransactionsSheet(data) {
    const rows = [
      {
        rowIdx: 1,
        height: 24,
        cells: [
          { col: 1, value: 'No Trx', style: 4 },
          { col: 2, value: 'Jam (WIB)', style: 4 },
          { col: 3, value: 'Status', style: 4 },
          { col: 4, value: 'Metode', style: 4 },
          { col: 5, value: 'Rincian Pesanan', style: 3 },
          { col: 6, value: 'Total', style: 5 },
          { col: 7, value: 'Uang Diterima', style: 5 },
          { col: 8, value: 'Kembalian', style: 5 },
          { col: 9, value: 'Catatan', style: 3 },
        ],
      },
    ];

    let r = 2;
    const list = data.transactions || [];
    if (list.length === 0) {
      rows.push({
        rowIdx: r,
        height: 22,
        cells: [
          { col: 1, value: '-', style: 7 },
          { col: 2, value: '-', style: 7 },
          { col: 3, value: '-', style: 7 },
          { col: 4, value: '-', style: 7 },
          { col: 5, value: 'Belum ada transaksi tercatat pada tanggal ini.', style: 6 },
          { col: 6, value: 0, style: 9 },
          { col: 7, value: '-', style: 7 },
          { col: 8, value: '-', style: 7 },
          { col: 9, value: '-', style: 6 },
        ],
      });
      r += 1;
    } else {
      for (const trx of list) {
        const isVoid = trx.status === 'VOID';
        const sLeft = isVoid ? 17 : 6;
        const sCenter = isVoid ? 18 : 7;
        const sCurr = isVoid ? 20 : 9;

        const hasCash = trx.uang_diterima !== null && trx.uang_diterima !== undefined;
        const uangVal = hasCash ? Number(trx.uang_diterima) : (trx.metode_bayar === 'CASH' ? 'Uang Pas' : '-');
        const kembaliVal = hasCash ? Number(trx.kembalian || 0) : '-';

        rows.push({
          rowIdx: r,
          height: 20,
          cells: [
            { col: 1, value: `#${trx.id_transaction}`, style: sCenter },
            { col: 2, value: trx.jam_wib, style: sCenter },
            { col: 3, value: trx.status, style: sCenter },
            { col: 4, value: trx.metode_bayar, style: sCenter },
            { col: 5, value: sanitizeExcelText(trx.ringkasan), style: sLeft },
            { col: 6, value: trx.total_harga, style: sCurr },
            { col: 7, value: uangVal, style: typeof uangVal === 'number' ? sCurr : sCenter },
            { col: 8, value: kembaliVal, style: typeof kembaliVal === 'number' ? sCurr : sCenter },
            { col: 9, value: sanitizeExcelText(trx.catatan_bayar), style: sLeft },
          ],
        });
        r += 1;
      }
    }

    rows.push({
      rowIdx: r,
      height: 22,
      cells: [
        { col: 1, value: 'Total Transaksi PAID', style: 11 },
        { col: 2, value: '', style: 11 },
        { col: 3, value: '', style: 11 },
        { col: 4, value: '', style: 11 },
        { col: 5, value: `${data.jumlah_paid} transaksi berhasil`, style: 11 },
        { col: 6, value: data.total_pendapatan, style: 13 },
        { col: 7, value: '', style: 11 },
        { col: 8, value: '', style: 11 },
        { col: 9, value: '', style: 11 },
      ],
    });

    return buildWorksheetXml(rows, [12, 12, 10, 10, 38, 18, 18, 16, 24], true);
  }

  function buildDetailsSheet(data) {
    const rows = [
      {
        rowIdx: 1,
        height: 24,
        cells: [
          { col: 1, value: 'No Trx', style: 4 },
          { col: 2, value: 'Jam (WIB)', style: 4 },
          { col: 3, value: 'Status', style: 4 },
          { col: 4, value: 'Metode', style: 4 },
          { col: 5, value: 'Nama Item', style: 3 },
          { col: 6, value: 'Harga Satuan', style: 5 },
          { col: 7, value: 'Qty', style: 5 },
          { col: 8, value: 'Subtotal', style: 5 },
        ],
      },
    ];

    let r = 2;
    const lines = data.detail_lines || [];
    if (lines.length === 0) {
      rows.push({
        rowIdx: r,
        height: 22,
        cells: [
          { col: 1, value: '-', style: 7 },
          { col: 2, value: '-', style: 7 },
          { col: 3, value: '-', style: 7 },
          { col: 4, value: '-', style: 7 },
          { col: 5, value: 'Belum ada rincian item pada tanggal ini.', style: 6 },
          { col: 6, value: 0, style: 9 },
          { col: 7, value: 0, style: 8 },
          { col: 8, value: 0, style: 9 },
        ],
      });
      r += 1;
    } else {
      for (const line of lines) {
        const isVoid = line.status === 'VOID';
        const sLeft = isVoid ? 17 : 6;
        const sCenter = isVoid ? 18 : 7;
        const sInt = isVoid ? 19 : 8;
        const sCurr = isVoid ? 20 : 9;

        rows.push({
          rowIdx: r,
          height: 20,
          cells: [
            { col: 1, value: `#${line.id_transaction}`, style: sCenter },
            { col: 2, value: line.jam_wib, style: sCenter },
            { col: 3, value: line.status, style: sCenter },
            { col: 4, value: line.metode_bayar, style: sCenter },
            { col: 5, value: sanitizeExcelText(line.nama_item), style: sLeft },
            { col: 6, value: line.harga_satuan, style: sCurr },
            { col: 7, value: line.qty, style: sInt },
            { col: 8, value: line.subtotal, style: sCurr },
          ],
        });
        r += 1;
      }
    }

    rows.push({
      rowIdx: r,
      height: 22,
      cells: [
        { col: 1, value: '', style: 11 },
        { col: 2, value: '', style: 11 },
        { col: 3, value: '', style: 11 },
        { col: 4, value: '', style: 11 },
        { col: 5, value: 'Total Item PAID', style: 11 },
        { col: 6, value: '', style: 11 },
        { col: 7, value: data.total_item_terjual, style: 12 },
        { col: 8, value: data.total_pendapatan, style: 13 },
      ],
    });

    return buildWorksheetXml(rows, [12, 12, 10, 10, 30, 18, 10, 18], true);
  }

  function createZipStore(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const dataBytes = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      // Local file header (30 bytes + name)
      const localHeader = new ArrayBuffer(30 + nameBytes.length);
      const lv = new DataView(localHeader);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); // version needed
      lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
      lv.setUint16(8, 0, true); // compression: STORE
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      new Uint8Array(localHeader, 30).set(nameBytes);

      localParts.push(new Uint8Array(localHeader), dataBytes);

      // Central directory header (46 bytes + name)
      const centralHeader = new ArrayBuffer(46 + nameBytes.length);
      const cv = new DataView(centralHeader);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      new Uint8Array(centralHeader, 46).set(nameBytes);

      centralParts.push(new Uint8Array(centralHeader));
      offset += 30 + nameBytes.length + size;
    }

    const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const allParts = [...localParts, ...centralParts, new Uint8Array(eocd)];
    const totalLen = allParts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const part of allParts) {
      out.set(part, pos);
      pos += part.length;
    }
    return out;
  }

  function buildDailyReportXlsxBytes(data) {
    const contentTypesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>';

    const rootRelsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    const workbookXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      '<sheet name="Ringkasan" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Riwayat Transaksi" sheetId="2" r:id="rId2"/>' +
      '<sheet name="Rincian Item" sheetId="3" r:id="rId3"/>' +
      '</sheets>' +
      '</workbook>';

    const workbookRelsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>' +
      '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    return createZipStore([
      { name: '[Content_Types].xml', data: contentTypesXml },
      { name: '_rels/.rels', data: rootRelsXml },
      { name: 'xl/workbook.xml', data: workbookXml },
      { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
      { name: 'xl/styles.xml', data: buildStylesXml() },
      { name: 'xl/worksheets/sheet1.xml', data: buildRingkasanSheet(data) },
      { name: 'xl/worksheets/sheet2.xml', data: buildTransactionsSheet(data) },
      { name: 'xl/worksheets/sheet3.xml', data: buildDetailsSheet(data) },
    ]);
  }

  return {
    buildDailyReportXlsxBytes,
    sanitizeExcelText,
  };
});
