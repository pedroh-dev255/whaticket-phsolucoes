import { join } from "path";
import { promisify } from "util";
import { writeFile } from "fs";
import * as Sentry from "@sentry/node";

import ListSettingsServiceOne from "../SettingServices/ListSettingsServiceOne";

import {
  Contact as WbotContact,
  Message as WbotMessage,
  MessageAck,
  Client
} from "whatsapp-web.js";

import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";

import { getIO } from "../../libs/socket";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { logger } from "../../utils/logger";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import { debounce } from "../../helpers/Debounce";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import CreateContactService from "../ContactServices/CreateContactService";
import GetContactService from "../ContactServices/GetContactService";
import formatBody from "../../helpers/Mustache";

interface Session extends Client {
  id?: number;
}

const writeFileAsync = promisify(writeFile);

const verifyContact = async (msgContact: WbotContact): Promise<Contact> => {
  const profilePicUrl = await msgContact.getProfilePicUrl();

  const contactData = {
    name: msgContact.name || msgContact.pushname || msgContact.id.user,
    number: msgContact.id.user,
    profilePicUrl,
    isGroup: msgContact.isGroup
  };

  const contact = CreateOrUpdateContactService(contactData);

  return contact;
};

const verifyQuotedMessage = async (
  msg: WbotMessage
): Promise<Message | null> => {
  if (!msg.hasQuotedMsg) return null;

  const wbotQuotedMsg = await msg.getQuotedMessage();

  const quotedMsg = await Message.findOne({
    where: { id: wbotQuotedMsg.id.id }
  });

  if (!quotedMsg) return null;

  return quotedMsg;
};


// generate random id string for file names, function got from: https://stackoverflow.com/a/1349426/1851801
function makeRandomId(length: number) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
      counter += 1;
    }
    return result;
}

const verifyMediaMessage = async (
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
): Promise<Message> => {
  const quotedMsg = await verifyQuotedMessage(msg);

  const media = await msg.downloadMedia();

  if (!media) {
    throw new Error("ERR_WAPP_DOWNLOAD_MEDIA");
  }

  let randomId = makeRandomId(5);

  if (!media.filename) {
    const ext = media.mimetype.split("/")[1].split(";")[0];
    media.filename = `${randomId}-${new Date().getTime()}.${ext}`;
  } else {
    media.filename = media.filename.split('.').slice(0,-1).join('.')+'.'+randomId+'.'+media.filename.split('.').slice(-1);
  }

  try {
    await writeFileAsync(
      join(__dirname, "..", "..", "..", "public", media.filename),
      media.data,
      "base64"
    );
  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }

  const messageData = {
    id: msg.id.id,
    ticketId: ticket.id,
    contactId: msg.fromMe ? undefined : contact.id,
    body: msg.body || media.filename,
    fromMe: msg.fromMe,
    read: msg.fromMe,
    mediaUrl: media.filename,
    mediaType: media.mimetype.split("/")[0],
    quotedMsgId: quotedMsg?.id
  };

  await ticket.update({ lastMessage: msg.body || media.filename });
  const newMessage = await CreateMessageService({ messageData });

  return newMessage;
};

const verifyMessage = async (
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
) => {

  if (msg.type === 'location')
    msg = prepareLocation(msg);

  const quotedMsg = await verifyQuotedMessage(msg);
  const messageData = {
    id: msg.id.id,
    ticketId: ticket.id,
    contactId: msg.fromMe ? undefined : contact.id,
    body: msg.body,
    fromMe: msg.fromMe,
    mediaType: msg.type,
    read: msg.fromMe,
    quotedMsgId: quotedMsg?.id
  };

  await ticket.update({ lastMessage: msg.type === "location" ? msg.location.description ? "Localization - " + msg.location.description.split('\\n')[0] : "Localization" : msg.body });

  await CreateMessageService({ messageData });
};

const prepareLocation = (msg: WbotMessage): WbotMessage => {
  let gmapsUrl = "https://maps.google.com/maps?q=" + msg.location.latitude + "%2C" + msg.location.longitude + "&z=17&hl=pt-BR";

  msg.body = "data:image/png;base64," + msg.body + "|" + gmapsUrl;

  msg.body += "|" + (msg.location.description ? msg.location.description : (msg.location.latitude + ", " + msg.location.longitude))

  return msg;
};

const verifyQueue = async (
  wbot: Session,
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
) => {
  const { queues, greetingMessage,outServiceMessage,openingHours,closingHours } = await ShowWhatsAppService(wbot.id!);

  const Hr = new Date();
  const hh: number = Hr.getHours() * 24 * 60;
  const mm: number = Hr.getMinutes() * 24;
  const ss: number = Hr.getSeconds();
  const hora = hh + mm + ss;

  // HORA QUE PARA DE ENVIAR MENSAGEM FORA DE HORARIO DE ATENDIMENTO
  const inicio = openingHours;
  const hhinicio = Number(inicio.split(":")[0]) * 24 * 60;
  const mminicio = Number(inicio.split(":")[1]) * 24;
  const ssinicio = Number(inicio.split(":")[2]);
  const horainicio = hhinicio + mminicio + ssinicio;

  // HORA QUE COMEÇA A ENVIAR MENSAGEM FORA DE HORARIO DE ATENDIMENTO
  const terminio = closingHours;
  const hhterminio = Number(terminio.split(":")[0]) * 24 * 60;
  const mmterminio = Number(terminio.split(":")[1]) * 24;
  const ssterminio = Number(terminio.split(":")[2]);
  const horaterminio = hhterminio + mmterminio + ssterminio;

  let withClosingTime = false;
  logger.info("withClosingTime: 0");
  if (openingHours != "" && closingHours != "") {
    logger.info("withClosingTime: 1");
    withClosingTime = true;
  }



  if (queues.length === 1) {
    await UpdateTicketService({
      ticketData: { queueId: queues[0].id },
      ticketId: ticket.id
    });
  if (withClosingTime && (hora < horainicio || hora > horaterminio)) {
      const body = formatBody(
        `\u200e*Automático*:\n${
          outServiceMessage || "Não estamos disponível no momento"
        }`,
        contact
      );

      const sentMessage = await wbot.sendMessage(
        `${contact.number}@c.us`,
        body
      );

      await verifyMessage(sentMessage, ticket, contact);
      return;
    }

    return;
  }

  const selectedOption = msg.body;

  const choosenQueue = queues[+selectedOption - 1];

  if (choosenQueue) {
    await UpdateTicketService({
      ticketData: { queueId: choosenQueue.id },
      ticketId: ticket.id
    });

    if (withClosingTime && (hora < horainicio || hora > horaterminio)) {
      const body = formatBody(
        `\u200e*Automático*:\n${
          outServiceMessage || "Não estamos disponível no momento"
        }`,
        contact
      );

      const sentMessage = await wbot.sendMessage(
        `${contact.number}@c.us`,
        body
      );

      await verifyMessage(sentMessage, ticket, contact);
    } else {
      const body = formatBody(`\u200e${choosenQueue.greetingMessage}`, contact);

      const sentMessage = await wbot.sendMessage(
        `${contact.number}@c.us`,
        body
      );

      await verifyMessage(sentMessage, ticket, contact);
    }
  } else {
    let options = "";

    queues.forEach((queue, index) => {
      options += `*${index + 1}* - ${queue.name}\n`;
    });

    if (withClosingTime && (hora < horainicio || hora > horaterminio)) {
      const body = formatBody(
        `\u200e*Automático*:\n${
          outServiceMessage || "Não estamos disponível no momento"
        }`,
        contact
      );

      const debouncedSentMessage = debounce(
        async () => {
          const sentMessage = await wbot.sendMessage(
            `${contact.number}@c.us`,
            body
          );
          verifyMessage(sentMessage, ticket, contact);
        },
        3000,
        ticket.id
      );

      debouncedSentMessage();
    } else {
      const body = formatBody(`\u200e${greetingMessage}\n${options}`, contact);

      const debouncedSentMessage = debounce(
        async () => {
          const sentMessage = await wbot.sendMessage(
            `${contact.number}@c.us`,
            body
          );
          verifyMessage(sentMessage, ticket, contact);
        },
        3000,
        ticket.id
      );

      debouncedSentMessage();
    }
  }
};

const isValidMsg = (msg: WbotMessage): boolean => {
  if (msg.from === "status@broadcast") return false;
  if (
    msg.type === "chat" ||
    msg.type === "call_log" ||
    msg.type === "audio" ||
    msg.type === "ptt" ||
    msg.type === "video" ||
    msg.type === "image" ||
    msg.type === "document" ||
    msg.type === "vcard" ||
    //msg.type === "multi_vcard" ||
    msg.type === "sticker" ||
    msg.type === "location"
  )
    return true;
  return false;
};

const handleMessage = async (
  msg: WbotMessage,
  wbot: Session
): Promise<void> => {
  if (!isValidMsg(msg)) {
    return;
  }

  try {
    let msgContact: WbotContact;
    let groupContact: Contact | undefined;

    if (msg.fromMe) {
      // messages sent automatically by wbot have a special character in front of it
      // if so, this message was already been stored in database;
      if (/\u200e/.test(msg.body[0])) return;

      // media messages sent from me from cell phone, first comes with "hasMedia = false" and type = "image/ptt/etc"
      // in this case, return and let this message be handled by "media_uploaded" event, when it will have "hasMedia = true"

      if (!msg.hasMedia && msg.type !== "location" && msg.type !== "chat" && msg.type !== "vcard"
        //&& msg.type !== "multi_vcard"
      ) return;

      msgContact = await wbot.getContactById(msg.to);
    } else {
      const listSettingsService = await ListSettingsServiceOne({key: "call"});
      var callSetting = listSettingsService?.value;
      msgContact = await msg.getContact();
    }

    const chat = await msg.getChat();

    if (chat.isGroup) {
      let msgGroupContact;

      if (msg.fromMe) {
        msgGroupContact = await wbot.getContactById(msg.to);
      } else {
        msgGroupContact = await wbot.getContactById(msg.from);
      }

      groupContact = await verifyContact(msgGroupContact);
    }
    const whatsapp = await ShowWhatsAppService(wbot.id!);

    const unreadMessages = msg.fromMe ? 0 : chat.unreadCount;

    const contact = await verifyContact(msgContact);

    if (
      unreadMessages === 0 &&
      whatsapp.farewellMessage &&
      formatBody(whatsapp.farewellMessage, contact) === msg.body
    )
      return;

    const ticket = await FindOrCreateTicketService(
      contact,
      wbot.id!,
      unreadMessages,
      groupContact
    );


    //Teste Funcao "#sair"

    if(msg.fromMe){
    } else {
       let saida = "Atendimento Finalizado!";

        if(msg.body.toLowerCase() == '#sair'){
		wbot.sendMessage(msg.from,`${saida}`);
		ticket.status = "closed";

		const whatsapp = await ShowWhatsAppService(ticket.whatsappId);
		
		setTimeout(async () => {
			await UpdateTicketService({ticketId: ticket.id,ticketData:{status:"closed", queueId: undefined, userId: undefined}});
		}, 1000);
        }

    }

    if (msg.hasMedia) {
      await verifyMediaMessage(msg, ticket, contact);
    } else {
      await verifyMessage(msg, ticket, contact);
    }

    if (
      !ticket.queue &&
      !chat.isGroup &&
      !msg.fromMe &&
      !ticket.userId &&
      whatsapp.queues.length >= 1
    ) {
      await verifyQueue(wbot, msg, ticket, contact);
    }

    if (msg.type === "vcard") {
      try {
        const array = msg.body.split("\n");
        const obj = [];
        let contact = "";
        for (let index = 0; index < array.length; index++) {
          const v = array[index];
          const values = v.split(":");
          for (let ind = 0; ind < values.length; ind++) {
            if (values[ind].indexOf("+") !== -1) {
              obj.push({ number: values[ind] });
            }
            if (values[ind].indexOf("FN") !== -1) {
              contact = values[ind + 1];
            }
          }
        }
        for await (const ob of obj) {
          const cont = await CreateContactService({
            name: contact,
            number: ob.number.replace(/\D/g, "")
          });
        }
      } catch (error) {
        console.log(error);
      }
    }

    /* if (msg.type === "multi_vcard") {
      try {
        const array = msg.vCards.toString().split("\n");
        let name = "";
        let number = "";
        const obj = [];
        const conts = [];
        for (let index = 0; index < array.length; index++) {
          const v = array[index];
          const values = v.split(":");
          for (let ind = 0; ind < values.length; ind++) {
            if (values[ind].indexOf("+") !== -1) {
              number = values[ind];
            }
            if (values[ind].indexOf("FN") !== -1) {
              name = values[ind + 1];
            }
            if (name !== "" && number !== "") {
              obj.push({
                name,
                number
              });
              name = "";
              number = "";
            }
          }
        }

        // eslint-disable-next-line no-restricted-syntax
        for await (const ob of obj) {
          try {
            const cont = await CreateContactService({
              name: ob.name,
              number: ob.number.replace(/\D/g, "")
            });
            conts.push({
              id: cont.id,
              name: cont.name,
              number: cont.number
            });
          } catch (error) {
            if (error.message === "ERR_DUPLICATED_CONTACT") {
              const cont = await GetContactService({
                name: ob.name,
                number: ob.number.replace(/\D/g, ""),
                email: ""
              });
              conts.push({
                id: cont.id,
                name: cont.name,
                number: cont.number
              });
            }
          }
        }
        msg.body = JSON.stringify(conts);
      } catch (error) {
        console.log(error);
      }
    } */
    if(msg.type==="call_log" && callSetting==="disabled"){
        const sentMessage = await wbot.sendMessage(`${contact.number}@c.us`, "As chamadas de voz e vídeo estão desabilitas para esse WhatsApp, favor enviar uma mensagem de texto. Obrigado");
        await verifyMessage(sentMessage, ticket, contact);
    }
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Error handling whatsapp message: Err: ${err}`);
  }
};

const handleMsgAck = async (msg: WbotMessage, ack: MessageAck) => {
  await new Promise(r => setTimeout(r, 500));

  const io = getIO();

  try {
    const messageToUpdate = await Message.findByPk(msg.id.id, {
      include: [
        "contact",
        {
          model: Message,
          as: "quotedMsg",
          include: ["contact"]
        }
      ]
    });
    if (!messageToUpdate) {
      return;
    }
    await messageToUpdate.update({ ack });

    io.to(messageToUpdate.ticketId.toString()).emit("appMessage", {
      action: "update",
      message: messageToUpdate
    });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Error handling message ack. Err: ${err}`);
  }
};

const wbotMessageListener = (wbot: Session): void => {
  wbot.on("message_create", async msg => {
    handleMessage(msg, wbot);
  });

  wbot.on("media_uploaded", async msg => {
    handleMessage(msg, wbot);
  });

  wbot.on("message_ack", async (msg, ack) => {
    handleMsgAck(msg, ack);
  });
};

export { wbotMessageListener, handleMessage };