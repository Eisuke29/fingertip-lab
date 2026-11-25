// node local.mjs [port] : the same relay on this PC (for tests)
import s from './api/ws.js'; s.listen(+process.argv[2] || 8790, () => console.log('relay', s.address().port));
