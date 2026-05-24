use std::sync::{Mutex, OnceLock};

const CACHE_SLOTS: usize = 4096;

/// Pack (r, g, b, a) into a single u32 key.
fn pack_key(r: u8, g: u8, b: u8, a: u8) -> u32 {
    (r as u32) | ((g as u32) << 8) | ((b as u32) << 16) | ((a as u32) << 24)
}

struct Cache {
    keys: [u32; CACHE_SLOTS],
    vals: [f64; CACHE_SLOTS * 3],
}

impl Cache {
    const fn new() -> Self {
        Self {
            keys: [0; CACHE_SLOTS],
            vals: [0.0; CACHE_SLOTS * 3],
        }
    }

    fn get(&self, r: u8, g: u8, b: u8, a: u8) -> Option<(f64, f64, f64)> {
        let key = pack_key(r, g, b, a);
        let idx = (key as usize) & (CACHE_SLOTS - 1);
        if self.keys[idx] == key {
            let base = idx * 3;
            Some((self.vals[base], self.vals[base + 1], self.vals[base + 2]))
        } else {
            None
        }
    }

    fn set(&mut self, r: u8, g: u8, b: u8, a: u8, oklch: (f64, f64, f64)) {
        let key = pack_key(r, g, b, a);
        let idx = (key as usize) & (CACHE_SLOTS - 1);
        self.keys[idx] = key;
        let base = idx * 3;
        self.vals[base] = oklch.0;
        self.vals[base + 1] = oklch.1;
        self.vals[base + 2] = oklch.2;
    }
}

static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();

fn cache() -> &'static Mutex<Cache> {
    CACHE.get_or_init(|| Mutex::new(Cache::new()))
}

pub fn cache_get(r: u8, g: u8, b: u8, a: u8) -> Option<(f64, f64, f64)> {
    cache().lock().unwrap().get(r, g, b, a)
}

pub fn cache_set(r: u8, g: u8, b: u8, a: u8, oklch: (f64, f64, f64)) {
    cache().lock().unwrap().set(r, g, b, a, oklch);
}
