export const API_URL           = import.meta.env.VITE_API_URL || '';
export const REMOVE_BG_API_KEY = 'qEXhbSrYiwktPSkU7QSuWjoV';
export const SUPABASE_URL      = 'https://xvqgrxoccucycagzizae.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2cWdyeG9jY3VjeWNhZ3ppemFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMDI2OTksImV4cCI6MjA5MTg3ODY5OX0.kHcqnGOmoho5bAcohaEmpwTHpz8Jt3Nmyk-b3yY4Wx0';
export const STORAGE           = `${SUPABASE_URL}/storage/v1/object/public`;

export const TRACKS = [
  { name: '360º',                   file: `${STORAGE}/music/360.mp3`,                                 key: '9A',  bpm: 120 },
  { name: 'Hedge Fund Trance Pt.1', file: `${STORAGE}/music/Hedge%20Fund%20Trance%20(Part%201).mp3`, key: '3B',  bpm: 120 },
  { name: 'Hedge Fund Trance Pt.2', file: `${STORAGE}/music/Hedge%20Fund%20Trance%20(Part%202).mp3`, key: '12B', bpm: 120 },
];

export const QUOTES = [
  { text: "If you're not living on the edge you're taking too much space.", author: "BFRND" },
  { text: "We make noise, not clothes.", author: "Undercover" },
  { text: "World Famous.", author: "Supreme" },
  { text: "The Future Is In The Past.", author: "Human Made" },
  { text: "Everything I do is for the 17-year-old version of myself.", author: "Virgil Abloh" },
  { text: "Always be knolling.", author: "Tom Sachs" },
];

export const ITEM_TYPES = ['Shirt','T-Shirt','Sweatshirt','Jeans','Jacket','Coat','Trousers','Shorts','Footwear','Accessories','Other'];
