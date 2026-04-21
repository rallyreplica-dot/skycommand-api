# Using PM2 for Reliable Node.js Server Management

PM2 is a production process manager for Node.js applications. It automatically restarts your server if it crashes, handles port conflicts gracefully, and provides easy monitoring and log management.

## 1. Install PM2 (one-time)

Open a terminal and run:

    npm install -g pm2

## 2. Start your server with PM2

From the `skycommand-api` directory:

    pm2 start server.js --name skycommand-api

## 3. View running processes

    pm2 list

## 4. View logs

    pm2 logs skycommand-api

## 5. Stop the server

    pm2 stop skycommand-api

## 6. Restart the server

    pm2 restart skycommand-api

## 7. Remove the server from PM2

    pm2 delete skycommand-api

## 8. Auto-start on system boot (optional)

    pm2 startup
    pm2 save

---

**Tip:** PM2 will automatically restart your server if it crashes or if the port is temporarily unavailable. This improves reliability and reduces manual intervention.

For more info, see: https://pm2.keymetrics.io/
