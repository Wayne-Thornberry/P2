// ── Supported countries / currencies ─────────────────────────
// Add new entries here to support additional countries in the future.

export interface BankDef {
  id: string
  abbr: string
  name: string
  color: string
  prefix: string
  /** Maps to a CsvAdapter.id — shown as a recommended adapter when importing */
  adapterId?: string
}

export interface CountryDef {
  id: string
  name: string
  flag: string
  currency: string
  locale: string
  banks: BankDef[]
}

export const SUPPORTED_COUNTRIES: CountryDef[] = [
  {
    id:       'ireland',
    name:     'Ireland',
    flag:     '🇮🇪',
    currency: 'EUR',
    locale:   'en-IE',
    banks: [
      { id: 'boi',    abbr: 'BOI',  name: 'Bank of Ireland', color: '#003B6F', prefix: 'BOI',          adapterId: 'boi'  },
      { id: 'aib',    abbr: 'AIB',  name: 'AIB',             color: '#007B5E', prefix: 'AIB'                             },
      { id: 'ptsb',   abbr: 'PTSB', name: 'Permanent TSB',   color: '#006B3F', prefix: 'PTSB'                            },
      { id: 'anpost', abbr: 'AP',   name: 'An Post',         color: '#CC1A1A', prefix: 'An Post'                         },
      { id: 'cu',     abbr: 'CU',   name: 'Credit Union',    color: '#003B8E', prefix: 'Credit Union'                    },
      { id: 'rev',    abbr: 'R',    name: 'Revolut',         color: '#191C1F', prefix: 'Revolut',       adapterId: 'revolut' },
      { id: 'n26',    abbr: 'N26',  name: 'N26',             color: '#23B07D', prefix: 'N26'                             },
      { id: 'wise',   abbr: 'W',    name: 'Wise',            color: '#00B9A0', prefix: 'Wise'                            },
    ],
  },
  {
    id:       'sweden',
    name:     'Sweden',
    flag:     '🇸🇪',
    currency: 'SEK',
    locale:   'sv-SE',
    banks: [
      { id: 'seb',      abbr: 'SEB', name: 'SEB',           color: '#60B2B2', prefix: 'SEB',      adapterId: 'seb' },
      { id: 'swedbank', abbr: 'SW',  name: 'Swedbank',      color: '#FF5A05', prefix: 'Swedbank'                   },
      { id: 'handels',  abbr: 'SHB', name: 'Handelsbanken', color: '#1B3F6E', prefix: 'SHB'                        },
      { id: 'nordea',   abbr: 'NDA', name: 'Nordea',        color: '#00005E', prefix: 'Nordea'                     },
      { id: 'rev',      abbr: 'R',   name: 'Revolut',       color: '#191C1F', prefix: 'Revolut',   adapterId: 'revolut' },
      { id: 'n26',      abbr: 'N26', name: 'N26',           color: '#23B07D', prefix: 'N26'                        },
      { id: 'wise',     abbr: 'W',   name: 'Wise',          color: '#00B9A0', prefix: 'Wise'                       },
    ],
  },
]

export function getCountryById(id: string): CountryDef | undefined {
  return SUPPORTED_COUNTRIES.find(c => c.id === id)
}
