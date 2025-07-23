// components/chat/ChatInput.tsx
import { ChatbotUIContext } from "@/context/context"
import useHotkey from "@/lib/hooks/use-hotkey"
import { LLM_LIST } from "@/lib/models/llm/llm-list"
import { cn } from "@/lib/utils"
import {
  IconBolt,
  IconCirclePlus,
  IconPlayerStopFilled,
  IconSend
} from "@tabler/icons-react"
import Image from "next/image"
import { FC, useContext, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Input } from "../ui/input"
import { TextareaAutosize } from "../ui/textarea-autosize"
import { ChatCommandInput } from "./chat-command-input"
import { ChatFilesDisplay } from "./chat-files-display"
import { useChatHandler } from "./chat-hooks/use-chat-handler"
import { useChatHistoryHandler } from "./chat-hooks/use-chat-history"
import { usePromptAndCommand } from "./chat-hooks/use-prompt-and-command"
import { useSelectFileHandler } from "./chat-hooks/use-select-file-handler"

interface ChatInputProps { }

export const ChatInput: FC<ChatInputProps> = () => {
  const { t } = useTranslation()
  const [isTyping, setIsTyping] = useState(false)
  const [useWebSearch, setUseWebSearch] = useState(false)

  const {
    isAssistantPickerOpen,
    focusAssistant,
    setFocusAssistant,
    userInput,
    chatMessages,
    isGenerating,
    selectedPreset,
    selectedAssistant,
    focusPrompt,
    setFocusPrompt,
    focusFile,
    focusTool,
    setFocusTool,
    isToolPickerOpen,
    isPromptPickerOpen,
    setIsPromptPickerOpen,
    isFilePickerOpen,
    setFocusFile,
    chatSettings,
    selectedTools,
    setSelectedTools,
    assistantImages
  } = useContext(ChatbotUIContext)

  const {
    chatInputRef,
    handleSendMessage,
    handleStopMessage,
    handleFocusChatInput
  } = useChatHandler()

  const { handleInputChange } = usePromptAndCommand()
  const { filesToAccept, handleSelectDeviceFile } = useSelectFileHandler()
  const {
    setNewMessageContentToNextUserMessage,
    setNewMessageContentToPreviousUserMessage
  } = useChatHistoryHandler()

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => {
      handleFocusChatInput()
    }, 200)
  }, [selectedPreset, selectedAssistant])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // on Enter (no shift) send, passing useWebSearch flag
    if (!isTyping && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      setIsPromptPickerOpen(false)
      handleSendMessage(userInput, chatMessages, false, useWebSearch)
    }

    // navigate pickers
    if (
      isPromptPickerOpen ||
      isFilePickerOpen ||
      isToolPickerOpen ||
      isAssistantPickerOpen
    ) {
      if (
        event.key === "Tab" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault()
        if (isPromptPickerOpen) setFocusPrompt(!focusPrompt)
        if (isFilePickerOpen) setFocusFile(!focusFile)
        if (isToolPickerOpen) setFocusTool(!focusTool)
        if (isAssistantPickerOpen) setFocusAssistant(!focusAssistant)
      }
    }

    // edit history navigation
    if (event.key === "ArrowUp" && event.shiftKey && event.ctrlKey) {
      event.preventDefault()
      setNewMessageContentToPreviousUserMessage()
    }
    if (event.key === "ArrowDown" && event.shiftKey && event.ctrlKey) {
      event.preventDefault()
      setNewMessageContentToNextUserMessage()
    }
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    const imagesAllowed = LLM_LIST.find(
      llm => llm.modelId === chatSettings?.model
    )?.imageInput

    for (const item of event.clipboardData.items) {
      if (item.type.startsWith("image")) {
        if (!imagesAllowed) {
          toast.error(
            t(
              "Bilder werden von diesem Modell nicht unterstützt. Bitte verwende z.B. GPT-4 Vision."
            )
          )
          return
        }
        const file = item.getAsFile()
        if (file) handleSelectDeviceFile(file)
      }
    }
  }

  return (
    <>
      {/* ==== files, tools, assistant banner ==== */}
      <div className="flex flex-col gap-2">
        <ChatFilesDisplay />

        {selectedTools.map(tool => (
          <div
            key={tool.id}
            className="flex justify-center"
            onClick={() =>
              setSelectedTools(selectedTools.filter(t => t.id !== tool.id))
            }
          >
            <div className="flex cursor-pointer items-center space-x-1 rounded-lg bg-purple-600 px-3 py-1 hover:opacity-50">
              <IconBolt size={20} />
              <div>{tool.name}</div>
            </div>
          </div>
        ))}

        {selectedAssistant && (
          <div className="border-primary mx-auto flex w-fit items-center space-x-2 rounded-lg border p-1.5">
            {selectedAssistant.image_path && (
              <Image
                className="rounded"
                src={
                  assistantImages.find(
                    img => img.path === selectedAssistant.image_path
                  )?.base64 || ""
                }
                width={28}
                height={28}
                alt={selectedAssistant.name}
              />
            )}
            <div className="text-sm font-bold">
              {t("Spricht mit")} {selectedAssistant.name}
            </div>
          </div>
        )}

        {/* ==== web‑search toggle ==== */}
        <div className="flex items-center px-4">
          <input
            id="web-search-toggle"
            type="checkbox"
            checked={useWebSearch}
            onChange={e => setUseWebSearch(e.target.checked)}
            className="mr-2 size-4 rounded border-gray-300"
          />
          <label htmlFor="web-search-toggle" className="text-sm">
            {t("Websuche aktivieren")}
          </label>
        </div>
      </div>

      {/* ==== input area ==== */}
      <div className="border-input relative mt-3 flex min-h-[60px] w-full items-center justify-center rounded-xl border-2">
        {/* slash‑commands */}
        <div className="absolute bottom-[76px] left-0 max-h-[300px] w-full overflow-auto rounded-xl">
          <ChatCommandInput />
        </div>

        {/* file picker */}
        <IconCirclePlus
          className="absolute bottom-[12px] left-3 cursor-pointer p-1 hover:opacity-50"
          size={32}
          onClick={() => fileInputRef.current?.click()}
        />
        <Input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={e => {
            if (e.target.files) handleSelectDeviceFile(e.target.files[0])
          }}
          accept={filesToAccept}
        />

        {/* text input */}
        <TextareaAutosize
          textareaRef={chatInputRef}
          className="ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring text-md flex w-full resize-none rounded-md border-none bg-transparent px-14 py-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={t("Wie kann ich dir heute helfen?")}
          onValueChange={handleInputChange}
          value={userInput}
          minRows={1}
          maxRows={18}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={() => setIsTyping(true)}
          onCompositionEnd={() => setIsTyping(false)}
        />

        {/* send / stop */}
        <div className="absolute bottom-[14px] right-3 cursor-pointer hover:opacity-50">
          {isGenerating ? (
            <IconPlayerStopFilled
              className="hover:bg-background animate-pulse rounded bg-transparent p-1"
              onClick={handleStopMessage}
              size={30}
            />
          ) : (
            <IconSend
              className={cn(
                "bg-primary text-secondary rounded p-1",
                !userInput && "cursor-not-allowed opacity-50"
              )}
              onClick={() => {
                if (!userInput) return
                handleSendMessage(userInput, chatMessages, false, useWebSearch)
              }}
              size={30}
            />
          )}
        </div>
      </div>
    </>
  )
}
