// --- helpers/systemUtils.ts ---
import { spawn } from 'child_process'
import { Socket } from 'socket.io'
import Store from 'electron-store'
import systeminformation from 'systeminformation'
import { getFonts } from 'font-list'
import { EVENTS } from './generalUtils.js'

const store = new Store()
const adminPassword = store.get('password')

export async function getSystemInfo() {
    try {
        const [
            cpu,
            cpuTemperature,
            currentLoad,
            fsSize,
            gpu,
            memory,
            networkInterfaces,
            networkStats,
        ] = await Promise.all([
            systeminformation.cpu(),
            systeminformation.cpuTemperature(),
            systeminformation.currentLoad(),
            systeminformation.fsSize(),
            systeminformation.graphics(),
            systeminformation.mem(),
            systeminformation.networkInterfaces(),
            systeminformation.networkStats(),
        ])
        return {
            cpu,
            cpuTemperature,
            currentLoad,
            fsSize,
            gpu,
            memory,
            networkInterfaces,
            networkStats,
        }
    } catch (error) {
        console.error('Error getting system information:', error)
        return null
    }
}

export function runScript(
    executable: string,
    args: string[],
    stdin: string
): Promise<string> {
    return new Promise((resolve, reject) => {
        console.log(`Running script: ${executable} ${args.join(' ')}`)

        const process = spawn(executable, args)

        let output = '',
            errorOutput = ''

        process.stdin.write(stdin)
        process.stdin.end()

        process.stdout.on('data', (data) => (output += data.toString()))
        process.stderr.on('data', (data) => (errorOutput += data.toString()))

        process.on('close', (code) => {
            code === 0
                ? resolve(output)
                : reject(`Error executing script: ${errorOutput}`)
        })

        process.on('error', (err) =>
            reject(`Failed to start process: ${err.message}`)
        )
    })
}

export async function getInstalledFontFamilies(): Promise<string[]> {
    try {
        const fonts = await getFonts()
        return [
            ...new Set(
                fonts.map((f) => f.trim().replace(/^"|"$/g, '')) // ← cleans up extra quotes
            ),
        ].sort()
    } catch (error) {
        console.error('Error listing fonts:', error)
        return []
    }
}

export function runSystemCommand(
    command: string[],
    successMessage: string,
    socket?: Socket
) {
    const proc = spawn(command[0], command.slice(1))

    proc.on('close', (code) => {
        if (socket) {
            socket.emit(
                EVENTS.COMMAND_RESULT,
                code === 0 ? successMessage : 'Error executing command.'
            )
        }
    })

    proc.on('error', (err) => {
        if (socket) {
            socket.emit(
                EVENTS.COMMAND_RESULT,
                `Error during execution: ${err.message}`
            )
        }
    })
}

export function shutdownSystem(minutes: number, socket?: Socket) {
    const platform = process.platform
    const msg = `The system will shut down in ${minutes} minutes.`

    let shutdownCmd: string[]
    if (platform === 'win32') {
        shutdownCmd = ['shutdown', '/s', '/f', '/t', (minutes * 60).toString()]
    } else if (platform === 'darwin') {
        // Use osascript — works without sudo, requires Accessibility permission
        if (minutes <= 0) {
            shutdownCmd = ['osascript', '-e', 'tell app "System Events" to shut down']
        } else {
            // Schedule via a background sleep + osascript
            shutdownCmd = [
                'bash', '-c',
                `sleep ${minutes * 60} && osascript -e 'tell app "System Events" to shut down'`,
            ]
        }
        // Show a notification too
        const notifyCmd = [
            'osascript',
            '-e',
            `display notification "${msg}" with title "Shutdown Alert"`,
        ]
        runSystemCommand(notifyCmd, msg, socket)
    } else {
        shutdownCmd = ['sudo', 'shutdown', '-h', `+${minutes}`, msg]
        const notifyCmd = ['notify-send', 'Shutdown Alert', msg]
        runSystemCommand(notifyCmd, msg, socket)
    }

    runSystemCommand(shutdownCmd, msg, socket)
}
