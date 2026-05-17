import { ActivityType, Client, GatewayIntentBits } from 'discord.js'
import Koa from 'koa'
import { executeSubscribeCommand } from './commands/subscribe'
import { executeUnsubscribeCommand } from './commands/unsubscribe'
import { Commands } from './constants'
import { Prisma, scheduleCronJob } from './utils'
import logger from './utils/logger'
import './config/environment'

const SCHEDULE = {
  DAY: '5 8-18 * * *',
  NIGHT: '5 21,0-6/3 * * *',
}

const BotClient = new Client({
  intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.Guilds],
})

BotClient.once('ready', (client) => {
  logger.info('Bot is ready!')
  client.user.setActivity('Galnet', { type: ActivityType.Watching })
  scheduleCronJob({ schedule: SCHEDULE.DAY, client })
  scheduleCronJob({ schedule: SCHEDULE.NIGHT, client })
})

// eslint-disable-next-line @typescript-eslint/no-misused-promises
BotClient.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return
  }

  const { commandName } = interaction

  try {
    if (commandName === Commands.SUBSCRIBE) {
      await executeSubscribeCommand({ interaction })
    } else if (commandName === Commands.UNSUBSCRIBE) {
      await executeUnsubscribeCommand({ interaction })
    }
  } catch (error) {
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Something went wrong 😔')
      } else {
        await interaction.reply({ content: 'Something went wrong 😔', ephemeral: true })
      }
    } catch (replyError) {
      logger.error('Failed to send error response to interaction', replyError)
    }
    logger.error('Error while handling command', error)
  }
})

// eslint-disable-next-line @typescript-eslint/no-misused-promises
BotClient.on('guildDelete', async (guild) => {
  logger.info(`Left guild ${guild.name} (${guild.id})`)
  // Try catch because prisma does not have delete if exists
  try {
    await Prisma.subscriber.delete({
      where: {
        guildId: guild.id,
      },
    })
    // eslint-disable-next-line no-empty
  } catch {}
})

void BotClient.login(process.env.BOT_TOKEN)

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error)
})

// Server used as a health check for the bot
const KoaApp = new Koa()
KoaApp.use((ctx) => {
  ctx.body = {
    status: 'ok',
    timestamp: new Date().toISOString(),
  }
})

const KoaServer = KoaApp.listen(process.env.PORT, () => {
  logger.info(`Koa server is running on port ${process.env.PORT!}`)
})

const shutdown = async () => {
  logger.info('Shutting down...')
  await BotClient.destroy()
  logger.info('Bot client destroyed')

  // Close Koa server
  logger.info('[Koa] Closing server...')
  await new Promise<void>((resolve) => {
    KoaServer.close(() => resolve())
  })
  logger.info('[Koa] Server closed')

  await Prisma.$disconnect()
  logger.info('Prisma disconnected')
  process.exit(0)
}

process.on('SIGTERM', () => {
  void shutdown()
})
process.on('SIGINT', () => {
  void shutdown()
})
