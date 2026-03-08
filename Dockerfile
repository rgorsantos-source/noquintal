FROM node:20-slim

Instala Google Chrome e dependências do Puppeteer
RUN apt-get update && apt-get install -y 

wget 

gnupg 

ca-certificates 

apt-transport-https 

--no-install-recommends 

&& wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - 

&& echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" 

> /etc/apt/sources.list.d/google-chrome.list 

&& apt-get update && apt-get install -y 

google-chrome-stable 

fonts-freefont-ttf 

libxss1 

--no-install-recommends 

&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "chatbot.js"]
