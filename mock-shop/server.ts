import { createShop } from './shop.ts'

const port = Number(process.env.PORT ?? 4000)
const { server } = createShop()
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ msg: 'mock shop listening', port })))
process.once('SIGTERM', () => server.close(() => process.exit(0)))
