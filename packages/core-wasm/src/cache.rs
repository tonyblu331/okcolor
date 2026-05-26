#[cfg(target_arch = "wasm32")]
use std::sync::Mutex as CacheLockInner;
use std::sync::OnceLock;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::RwLock as CacheLockInner;

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

type CacheLock = CacheLockInner<Cache>;

static CACHE: OnceLock<CacheLock> = OnceLock::new();

fn cache() -> &'static CacheLock {
    CACHE.get_or_init(|| CacheLockInner::new(Cache::new()))
}

pub fn cache_get(r: u8, g: u8, b: u8, a: u8) -> Option<(f64, f64, f64)> {
    #[cfg(target_arch = "wasm32")]
    {
        cache().lock().unwrap().get(r, g, b, a)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        cache().read().unwrap().get(r, g, b, a)
    }
}

pub fn cache_set(r: u8, g: u8, b: u8, a: u8, oklch: (f64, f64, f64)) {
    #[cfg(target_arch = "wasm32")]
    {
        cache().lock().unwrap().set(r, g, b, a, oklch);
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        cache().write().unwrap().set(r, g, b, a, oklch);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_all_operations_sequentially() {
        cache_set(201, 0, 0, 255, (0.62796, 0.25768, 29.2339));
        let v = cache_get(201, 0, 0, 255);
        assert!(v.is_some());
        let (l, c, h) = v.unwrap();
        assert!((l - 0.62796).abs() < 1e-4);
        assert!((c - 0.25768).abs() < 1e-4);
        assert!((h - 29.2339).abs() < 1e-4);

        assert!(cache_get(202, 0, 0, 255).is_none());

        cache_set(203, 0, 0, 255, (0.1, 0.2, 0.3));
        cache_set(203, 0, 0, 255, (0.4, 0.5, 0.6));
        let v = cache_get(203, 0, 0, 255).unwrap();
        assert!((v.0 - 0.4).abs() < 1e-4);

        cache_set(204, 0, 0, 255, (0.62796, 0.25768, 29.2339));
        assert!(cache_get(204, 0, 0, 255).is_some());
        cache_set(0, 205, 0, 255, (0.86644, 0.29483, 142.495));
        assert!(cache_get(0, 205, 0, 255).is_some());
        cache_set(0, 0, 206, 255, (0.45201, 0.31321, 264.052));
        assert!(cache_get(0, 0, 206, 255).is_some());

        cache_set(207, 0, 0, 128, (0.62796, 0.25768, 29.2339));
        assert!(cache_get(207, 0, 0, 255).is_none());
        assert!(cache_get(207, 0, 0, 128).is_some());
    }
}
